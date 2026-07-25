const TODAY_QUEUE_ORDER_SQL = `
  COALESCE(p.sort_order, p.id),
  CASE WHEN c.id IS NULL THEN 0 ELSE 1 END,
  COALESCE(c.sort_order, 0),
  COALESCE(i.sort_order, i.id),
  i.id
`;

function normalizeProjectId(value) {
  if (value === undefined || value === null || value === "") return null;
  const projectId = Number(value);
  if (!Number.isInteger(projectId) || projectId <= 0) return undefined;
  return projectId;
}

function createTodayQueueService({
  db,
  serializeTodoItem,
  normalizeBotKey,
  defaultBotKey,
  dispatchItem,
  recordFailure,
}) {
  const mutationLocks = new Set();

  function projectLockKey(projectId) {
    return projectId === null ? "legacy-global" : `project:${projectId}`;
  }

  function mutationIsLocked(projectId) {
    if (projectId === null) return mutationLocks.size > 0;
    return mutationLocks.has("legacy-global") || mutationLocks.has(projectLockKey(projectId));
  }

  function todayQueueSelectSql(whereClause = "") {
    return `
      SELECT i.*,
             p.name as project_name,
             p.emoji as project_emoji,
             p.discord_channel_id,
             p.discord_thread_id,
             p.default_ai_bot_key as project_default_ai_bot_key,
             p.sort_order as project_sort_order,
             c.name as category_name,
             c.sort_order as category_sort_order
        FROM items i
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.is_today=1
         AND i.owner='AI'
         ${whereClause}
       ORDER BY ${TODAY_QUEUE_ORDER_SQL}
    `;
  }

  function getItems(statuses = [], projectId = null) {
    const normalized = statuses.map(status => String(status || "").trim()).filter(Boolean);
    const conditions = [];
    const params = [];

    if (normalized.length) {
      conditions.push(`i.status IN (${normalized.map(() => "?").join(",")})`);
      params.push(...normalized);
    }
    if (projectId !== null) {
      conditions.push("i.project_id=?");
      params.push(projectId);
    }

    const whereClause = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
    return db.prepare(todayQueueSelectSql(whereClause)).all(...params);
  }

  function getProject(projectId) {
    return db.prepare(`
      SELECT id, name, emoji, sort_order, discord_channel_id, discord_thread_id,
             default_ai_bot_key as project_default_ai_bot_key
        FROM projects
       WHERE id=?
    `).get(projectId) || null;
  }

  function projectExists(projectId) {
    return projectId === null || Boolean(getProject(projectId));
  }

  function serializeQueueItem(item) {
    if (!item) return null;
    return {
      ...serializeTodoItem(item),
      project_id: item.project_id,
      project_name: item.project_name || null,
      project_emoji: item.project_emoji || null,
      category_id: item.category_id || null,
      category_name: item.category_name || null,
      project_sort_order: item.project_sort_order ?? null,
      category_sort_order: item.category_sort_order ?? null,
      default_ai_bot_key: normalizeBotKey(item.project_default_ai_bot_key || defaultBotKey),
      has_discord_target: Boolean(item.discord_thread_id || item.discord_channel_id),
    };
  }

  function countItems(items) {
    const counts = { todo: 0, in_progress: 0, review: 0, total: items.length };
    for (const item of items) {
      if (counts[item.status] !== undefined) counts[item.status] += 1;
    }
    return counts;
  }

  function buildProjectStatus(projectId, items = getItems(["todo", "in_progress", "review"], projectId)) {
    const project = items[0] || getProject(projectId);
    if (!project) return null;
    const active = items.filter(item => item.status === "in_progress");
    const next = items.find(item => item.status === "todo") || null;
    return {
      project_id: projectId,
      project_name: project.project_name || project.name || null,
      project_emoji: project.project_emoji || project.emoji || null,
      project_sort_order: project.project_sort_order ?? project.sort_order ?? null,
      has_discord_target: Boolean(project.discord_thread_id || project.discord_channel_id),
      running: active.length > 0,
      counts: countItems(items),
      active: active.map(serializeQueueItem),
      next: serializeQueueItem(next),
      items: items.map(serializeQueueItem),
    };
  }

  function buildStatus({ projectId = null, extra = {} } = {}) {
    const items = getItems(["todo", "in_progress", "review"], projectId);
    const active = items.filter(item => item.status === "in_progress");
    const next = items.find(item => item.status === "todo") || null;
    const grouped = new Map();

    for (const item of items) {
      if (!grouped.has(item.project_id)) grouped.set(item.project_id, []);
      grouped.get(item.project_id).push(item);
    }
    if (projectId !== null && !grouped.has(projectId) && projectExists(projectId)) {
      grouped.set(projectId, []);
    }

    const projects = [...grouped.entries()]
      .map(([id, projectItems]) => buildProjectStatus(id, projectItems))
      .filter(Boolean)
      .sort((a, b) => (a.project_sort_order ?? a.project_id) - (b.project_sort_order ?? b.project_id));

    return {
      running: active.length > 0,
      counts: countItems(items),
      active: active.map(serializeQueueItem),
      next: serializeQueueItem(next),
      items: items.map(serializeQueueItem),
      projects,
      ...extra,
    };
  }

  function actionStatus(projectId) {
    return projectId === null ? buildStatus() : buildProjectStatus(projectId);
  }

  function getItemById(itemId) {
    return db.prepare(todayQueueSelectSql("AND i.id=?")).get(itemId) || null;
  }

  async function dispatchNext({ projectId = null, botKey = null, allowWhenRunning = false } = {}) {
    const key = projectLockKey(projectId);
    if (mutationIsLocked(projectId)) {
      return { project_id: projectId, started: false, reason: "action_in_progress", status: actionStatus(projectId) };
    }

    mutationLocks.add(key);
    try {
      const active = getItems(["in_progress"], projectId);
      if (active.length && !allowWhenRunning) {
        return {
          project_id: projectId,
          started: false,
          reason: "already_running",
          active: active.map(serializeQueueItem),
          status: actionStatus(projectId),
        };
      }

      const next = getItems(["todo"], projectId)[0] || null;
      if (!next) {
        return { project_id: projectId, started: false, reason: "empty", status: actionStatus(projectId) };
      }

      if (!next.discord_thread_id && !next.discord_channel_id) {
        recordFailure(next.id, `item #${next.id} project has no Discord channel/thread mapping`);
        return {
          project_id: next.project_id,
          started: false,
          reason: "missing_discord_target",
          item: serializeQueueItem(next),
          status: actionStatus(projectId),
        };
      }

      try {
        const dispatchBotKey = botKey || next.project_default_ai_bot_key || defaultBotKey;
        const dispatch = await dispatchItem(next, { botKey: dispatchBotKey });
        return {
          project_id: next.project_id,
          started: true,
          reason: "dispatched",
          dispatch,
          item: serializeQueueItem(getItemById(next.id)),
          status: actionStatus(projectId),
        };
      } catch (error) {
        recordFailure(next.id, error);
        return {
          project_id: next.project_id,
          started: false,
          reason: "dispatch_failed",
          error: String(error?.message || error),
          item: serializeQueueItem(next),
          status: actionStatus(projectId),
        };
      }
    } finally {
      mutationLocks.delete(key);
    }
  }

  function stop({ projectId = null } = {}) {
    if (mutationIsLocked(projectId)) {
      return { project_id: projectId, stopped: 0, reason: "action_in_progress", status: actionStatus(projectId) };
    }

    const key = projectLockKey(projectId);
    mutationLocks.add(key);
    try {
      const active = getItems(["in_progress"], projectId);
      const statement = db.prepare(`
        UPDATE items
           SET status='todo',
               dispatch_nonce=NULL,
               dispatch_started_at=NULL,
               dispatch_last_error=?
         WHERE id=?
      `);
      for (const item of active) statement.run("today queue stopped", item.id);
      return {
        project_id: projectId,
        stopped: active.length,
        reason: "stopped",
        items: active.map(serializeQueueItem),
        status: actionStatus(projectId),
      };
    } finally {
      mutationLocks.delete(key);
    }
  }

  return {
    normalizeProjectId,
    projectExists,
    getItems,
    getItemById,
    buildProjectStatus,
    buildStatus,
    dispatchNext,
    stop,
  };
}

module.exports = {
  normalizeProjectId,
  createTodayQueueService,
};
