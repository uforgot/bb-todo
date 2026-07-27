const TODAY_QUEUE_ORDER_SQL = `
  COALESCE(p.sort_order, p.id),
  CASE WHEN i.today_queue_order IS NULL THEN 1 ELSE 0 END,
  i.today_queue_order,
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
  runLifecycle = null,
  createDispatchNonce = null,
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
         AND i.status<>'archived'
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

  function isQueueMember(item) {
    return Boolean(item)
      && Boolean(item.is_today)
      && item.owner === "AI"
      && item.status !== "archived";
  }

  function orderedProjectItems(projectId) {
    return db.prepare(`
      SELECT i.*
        FROM items i
        LEFT JOIN categories c ON i.category_id=c.id
       WHERE i.project_id=?
         AND i.is_today=1
         AND i.owner='AI'
         AND i.status<>'archived'
       ORDER BY CASE WHEN i.today_queue_order IS NULL THEN 1 ELSE 0 END,
                i.today_queue_order,
                CASE WHEN c.id IS NULL THEN 0 ELSE 1 END,
                COALESCE(c.sort_order, 0),
                COALESCE(i.sort_order, i.id),
                i.id
    `).all(projectId);
  }

  function applyProjectOrder(projectId, itemIds) {
    db.prepare("UPDATE items SET today_queue_order=NULL WHERE project_id=?").run(projectId);
    const update = db.prepare("UPDATE items SET today_queue_order=? WHERE id=? AND project_id=?");
    itemIds.forEach((itemId, index) => update.run(index + 1, itemId, projectId));
  }

  function normalizeProjectOrder(projectId) {
    const itemIds = orderedProjectItems(projectId).map(item => item.id);
    applyProjectOrder(projectId, itemIds);
    return itemIds;
  }

  function initializeOrder() {
    const projectIds = db.prepare(`
      SELECT DISTINCT project_id
        FROM items
       WHERE (is_today=1 AND owner='AI' AND status<>'archived')
          OR today_queue_order IS NOT NULL
       ORDER BY project_id
    `).all().map(row => row.project_id);
    db.transaction(() => {
      projectIds.forEach(normalizeProjectOrder);
    })();
  }

  function reconcileItem(before, after) {
    const wasMember = isQueueMember(before);
    const isMember = isQueueMember(after);
    const oldProjectId = before?.project_id ?? null;
    const newProjectId = after?.project_id ?? null;

    if (wasMember && isMember && oldProjectId === newProjectId) {
      if (after.today_queue_order == null) {
        const ids = orderedProjectItems(newProjectId).filter(item => item.id !== after.id).map(item => item.id);
        applyProjectOrder(newProjectId, [...ids, after.id]);
      }
      return;
    }

    if (oldProjectId !== null && (wasMember || before?.today_queue_order != null)) {
      normalizeProjectOrder(oldProjectId);
    }
    if (isMember) {
      const ids = orderedProjectItems(newProjectId).filter(item => item.id !== after.id).map(item => item.id);
      applyProjectOrder(newProjectId, [...ids, after.id]);
    }
  }

  function removeDeletedItem(item) {
    if (item?.project_id != null && (isQueueMember(item) || item.today_queue_order != null)) {
      normalizeProjectOrder(item.project_id);
    }
  }

  function runningItem(projectId) {
    return db.prepare(`
      SELECT id FROM items
       WHERE project_id=? AND is_today=1 AND owner='AI' AND status='in_progress'
       LIMIT 1
    `).get(projectId) || null;
  }

  function reorderProject({ projectId, itemIds }) {
    if (mutationIsLocked(projectId)) {
      return { ok: false, reason: "action_in_progress", status: 409 };
    }
    if (runningItem(projectId)) {
      return { ok: false, reason: "queue_running", status: 409 };
    }
    const currentIds = orderedProjectItems(projectId).map(item => item.id);
    const normalizedIds = Array.isArray(itemIds) ? itemIds.map(Number) : [];
    const validIds = normalizedIds.every(Number.isInteger);
    const uniqueIds = new Set(normalizedIds);
    const sameSet = validIds
      && uniqueIds.size === normalizedIds.length
      && normalizedIds.length === currentIds.length
      && currentIds.every(id => uniqueIds.has(id));
    if (!sameSet) {
      return { ok: false, reason: "stale_order", status: 409, current_item_ids: currentIds };
    }
    db.transaction(() => applyProjectOrder(projectId, normalizedIds))();
    return { ok: true, project_id: projectId, item_ids: normalizedIds };
  }

  function placeItem({ projectId, itemId, beforeItemId = null, afterItemId = null }) {
    if (mutationIsLocked(projectId)) {
      return { ok: false, reason: "action_in_progress", status: 409 };
    }
    if (beforeItemId !== null && afterItemId !== null) {
      return { ok: false, reason: "choose_before_or_after", status: 400 };
    }
    if (beforeItemId === itemId || afterItemId === itemId) {
      return { ok: false, reason: "anchor_is_item", status: 400 };
    }
    const item = db.prepare("SELECT * FROM items WHERE id=?").get(itemId);
    if (!item || item.project_id !== projectId) {
      return { ok: false, reason: "item_not_found", status: 404 };
    }
    if (item.owner !== "AI" || item.status === "archived") {
      return { ok: false, reason: "item_not_eligible", status: 409 };
    }

    const currentItems = orderedProjectItems(projectId);
    const active = currentItems.find(row => row.status === "in_progress") || null;
    const anchorId = beforeItemId ?? afterItemId;

    if (active) {
      if (!isQueueMember(item) || item.status !== "todo") {
        return { ok: false, reason: "item_not_pending", status: 409, active_item_id: active.id };
      }

      const pendingIds = currentItems
        .filter(row => row.status === "todo" && row.id !== itemId)
        .map(row => row.id);
      let insertIndex = pendingIds.length;
      if (anchorId !== null) {
        const anchor = currentItems.find(row => row.id === anchorId);
        if (!anchor) {
          return { ok: false, reason: "anchor_not_found", status: 409, current_item_ids: currentItems.map(row => row.id) };
        }
        if (anchor.status !== "todo") {
          return { ok: false, reason: "anchor_not_pending", status: 409, active_item_id: active.id };
        }
        const anchorIndex = pendingIds.indexOf(anchorId);
        insertIndex = beforeItemId !== null ? anchorIndex : anchorIndex + 1;
      }

      const nextPendingIds = [...pendingIds];
      nextPendingIds.splice(insertIndex, 0, itemId);
      let pendingIndex = 0;
      const nextIds = currentItems.map(row => (
        row.status === "todo" ? nextPendingIds[pendingIndex++] : row.id
      ));
      db.transaction(() => applyProjectOrder(projectId, nextIds))();
      return {
        ok: true,
        project_id: projectId,
        item_ids: nextIds,
        active_item_id: active.id,
        pending_item_ids: nextPendingIds,
      };
    }

    const currentIds = currentItems.filter(row => row.id !== itemId).map(row => row.id);
    let insertIndex = currentIds.length;
    if (anchorId !== null) {
      const anchorIndex = currentIds.indexOf(anchorId);
      if (anchorIndex < 0) {
        return { ok: false, reason: "anchor_not_found", status: 409, current_item_ids: currentIds };
      }
      insertIndex = beforeItemId !== null ? anchorIndex : anchorIndex + 1;
    }
    const nextIds = [...currentIds];
    nextIds.splice(insertIndex, 0, itemId);
    db.transaction(() => {
      db.prepare("UPDATE items SET is_today=1 WHERE id=?").run(itemId);
      applyProjectOrder(projectId, nextIds);
    })();
    return { ok: true, project_id: projectId, item_ids: nextIds };
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
      today_queue_order: item.today_queue_order ?? null,
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

  async function dispatchNext({
    projectId = null,
    botKey = null,
    allowWhenRunning = false,
    startedBy = "api",
    expectedRunId = null,
  } = {}) {
    const key = projectLockKey(projectId);
    if (mutationIsLocked(projectId)) {
      return { project_id: projectId, started: false, reason: "action_in_progress", status: actionStatus(projectId) };
    }

    mutationLocks.add(key);
    try {
      if (expectedRunId && runLifecycle && projectId !== null) {
        const currentRun = runLifecycle.getCurrentRun(projectId);
        if (!currentRun || currentRun.id !== expectedRunId) {
          return {
            project_id: projectId,
            started: false,
            reason: "run_mismatch",
            expected_run_id: expectedRunId,
            current_run_id: currentRun?.id || null,
            status: actionStatus(projectId),
          };
        }
      }

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
        const completedRun = runLifecycle && projectId !== null
          ? runLifecycle.completeRun(projectId)
          : null;
        return {
          project_id: projectId,
          started: false,
          reason: "empty",
          completed_run_id: completedRun?.id || null,
          status: actionStatus(projectId),
        };
      }

      const dispatchBotKey = botKey || next.project_default_ai_bot_key || defaultBotKey;
      let run = null;
      let attempt = null;
      try {
        if (runLifecycle) {
          run = runLifecycle.ensureRun({
            projectId: next.project_id,
            items: getItems(["todo"], next.project_id),
            startedBy,
            botKey: dispatchBotKey,
          });
          attempt = runLifecycle.beginAttempt({
            runId: run.id,
            item: next,
            botKey: dispatchBotKey,
            nonce: createDispatchNonce?.(),
          });
        }

        if (!next.discord_thread_id && !next.discord_channel_id) {
          const error = new Error(`item #${next.id} project has no Discord channel/thread mapping`);
          runLifecycle?.recordDispatchFailure({ taskRunId: attempt?.id, error });
          recordFailure(next.id, error);
          return {
            project_id: next.project_id,
            started: false,
            reason: "missing_discord_target",
            run_id: run?.id || null,
            task_run_id: attempt?.id || null,
            attempt: attempt?.attempt || null,
            item: serializeQueueItem(getItemById(next.id)),
            status: actionStatus(projectId),
          };
        }

        const dispatch = await dispatchItem(next, {
          botKey: dispatchBotKey,
          nonce: attempt?.dispatch_nonce || null,
          runId: run?.id || null,
          taskRunId: attempt?.id || null,
        });
        if (runLifecycle) {
          runLifecycle.recordDispatchSuccess({
            itemId: next.id,
            taskRunId: attempt.id,
            dispatch,
          });
        }
        return {
          project_id: next.project_id,
          started: true,
          reason: "dispatched",
          run_id: run?.id || null,
          task_run_id: attempt?.id || null,
          attempt: attempt?.attempt || null,
          dispatch,
          item: serializeQueueItem(getItemById(next.id)),
          status: actionStatus(projectId),
        };
      } catch (error) {
        runLifecycle?.recordDispatchFailure({ taskRunId: attempt?.id, error });
        recordFailure(next.id, error);
        return {
          project_id: next.project_id,
          started: false,
          reason: "dispatch_failed",
          run_id: run?.id || null,
          task_run_id: attempt?.id || null,
          attempt: attempt?.attempt || null,
          error: String(error?.message || error),
          item: serializeQueueItem(getItemById(next.id)),
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
      const serializedItems = active.map(serializeQueueItem);
      if (runLifecycle) {
        const projectIds = projectId === null
          ? [...new Set([
            ...active.map(item => item.project_id),
            ...runLifecycle.getRunningProjectIds(),
          ])]
          : [projectId];
        const stopped = projectIds.reduce((total, id) => (
          total + runLifecycle.stopProject({
            projectId: id,
            activeItems: active.filter(item => item.project_id === id),
          }).stopped
        ), 0);
        return {
          project_id: projectId,
          stopped,
          reason: "stopped",
          items: serializedItems,
          status: actionStatus(projectId),
        };
      }

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
        items: serializedItems,
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
    isQueueMember,
    initializeOrder,
    normalizeProjectOrder,
    reconcileItem,
    removeDeletedItem,
    reorderProject,
    placeItem,
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
