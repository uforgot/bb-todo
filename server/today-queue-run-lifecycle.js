const crypto = require("node:crypto");

function asErrorMessage(error) {
  return String(error?.message || error || "dispatch failed").slice(0, 1000);
}

function createTodayQueueRunLifecycle({
  db,
  createId = () => crypto.randomUUID(),
} = {}) {
  if (!db) throw new Error("today queue run lifecycle requires db");

  const getCurrentRunStatement = db.prepare(`
    SELECT r.*
      FROM projects p
      JOIN today_queue_runs r ON r.id=p.current_run_id
     WHERE p.id=? AND r.status='running'
  `);
  const getRunStatement = db.prepare("SELECT * FROM today_queue_runs WHERE id=?");
  const getTaskRunStatement = db.prepare("SELECT * FROM today_queue_task_runs WHERE id=?");

  function getCurrentRun(projectId) {
    return getCurrentRunStatement.get(projectId) || null;
  }

  function getCurrentTaskRun(itemId) {
    return db.prepare(`
      SELECT tr.*
        FROM items i
        JOIN today_queue_task_runs tr ON tr.id=i.current_task_run_id
       WHERE i.id=?
    `).get(itemId) || null;
  }

  function getRunningProjectIds() {
    return db.prepare(`
      SELECT p.id
        FROM projects p
        JOIN today_queue_runs r ON r.id=p.current_run_id
       WHERE r.status='running'
       ORDER BY p.id
    `).all().map(row => row.id);
  }

  function normalizeSequence(item, fallbackIndex) {
    const sequence = Number(item.today_queue_order ?? fallbackIndex);
    return Number.isInteger(sequence) && sequence > 0 ? sequence : fallbackIndex;
  }

  const createRun = db.transaction(({ projectId, items, startedBy, botKey }) => {
    const project = db.prepare(`
      SELECT id, name, emoji, current_run_id
        FROM projects
       WHERE id=?
    `).get(projectId);
    if (!project) throw new Error(`project #${projectId} not found`);

    if (project.current_run_id) {
      const linkedRun = getRunStatement.get(project.current_run_id);
      if (linkedRun?.status === "running") return linkedRun;
      db.prepare("UPDATE projects SET current_run_id=NULL WHERE id=?").run(projectId);
    }

    const unlinkedRunning = db.prepare(`
      SELECT id FROM today_queue_runs
       WHERE project_id=? AND status='running'
       LIMIT 1
    `).get(projectId);
    if (unlinkedRunning) {
      throw new Error(`project #${projectId} has unlinked running run ${unlinkedRunning.id}`);
    }

    const runId = createId("run");
    db.prepare(`
      INSERT INTO today_queue_runs (
        id, project_id, project_name, project_emoji, status, started_by
      ) VALUES (?, ?, ?, ?, 'running', ?)
    `).run(runId, project.id, project.name, project.emoji || null, startedBy || null);

    const insertTaskRun = db.prepare(`
      INSERT INTO today_queue_task_runs (
        id, run_id, project_id, item_id, category_id, sequence_index, attempt,
        status, item_title, item_content, category_name, issue_url, bot_key, queued_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?, ?, ?, datetime('now'))
    `);
    const linkItem = db.prepare("UPDATE items SET current_task_run_id=? WHERE id=?");
    items.forEach((item, index) => {
      const taskRunId = createId("task");
      insertTaskRun.run(
        taskRunId,
        runId,
        project.id,
        item.id,
        item.category_id ?? null,
        normalizeSequence(item, index + 1),
        item.title,
        item.content || null,
        item.category_name || null,
        item.issue_url || null,
        botKey || null,
      );
      linkItem.run(taskRunId, item.id);
    });
    db.prepare("UPDATE projects SET current_run_id=? WHERE id=?").run(runId, project.id);
    return getRunStatement.get(runId);
  });

  function ensureRun({ projectId, items, startedBy = null, botKey = null }) {
    const current = getCurrentRun(projectId);
    if (current) return current;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`project #${projectId} has no dispatchable items for a new run`);
    }
    return createRun({ projectId, items, startedBy, botKey });
  }

  const beginAttemptTransaction = db.transaction(({ runId, item, botKey, nonce }) => {
    const run = getRunStatement.get(runId);
    if (!run || run.status !== "running" || run.project_id !== item.project_id) {
      throw new Error(`run ${runId} is not active for project #${item.project_id}`);
    }

    const latest = db.prepare(`
      SELECT * FROM today_queue_task_runs
       WHERE run_id=? AND item_id=?
       ORDER BY attempt DESC
       LIMIT 1
    `).get(runId, item.id);

    let taskRunId;
    let attempt;
    if (latest?.status === "pending") {
      taskRunId = latest.id;
      attempt = latest.attempt;
      db.prepare(`
        UPDATE today_queue_task_runs
           SET status='active',
               bot_key=?,
               dispatch_nonce=?,
               started_at=datetime('now'),
               error=NULL,
               updated_at=datetime('now')
         WHERE id=? AND status='pending'
      `).run(botKey || latest.bot_key || null, nonce, taskRunId);
    } else {
      taskRunId = createId("task");
      attempt = (latest?.attempt || 0) + 1;
      db.prepare(`
        INSERT INTO today_queue_task_runs (
          id, run_id, project_id, item_id, category_id, sequence_index, attempt,
          status, item_title, item_content, category_name, issue_url, bot_key,
          dispatch_nonce, queued_at, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        taskRunId,
        runId,
        item.project_id,
        item.id,
        item.category_id ?? null,
        normalizeSequence(item, latest?.sequence_index || 1),
        attempt,
        item.title,
        item.content || null,
        item.category_name || null,
        item.issue_url || null,
        botKey || latest?.bot_key || null,
        nonce,
      );
    }

    db.prepare("UPDATE items SET current_task_run_id=? WHERE id=?").run(taskRunId, item.id);
    return getTaskRunStatement.get(taskRunId);
  });

  function beginAttempt({ runId, item, botKey, nonce }) {
    if (!nonce) throw new Error("dispatch nonce is required before creating an attempt");
    return beginAttemptTransaction({ runId, item, botKey, nonce });
  }

  const recordDispatchSuccessTransaction = db.transaction(({ itemId, taskRunId, dispatch }) => {
    const taskUpdate = db.prepare(`
      UPDATE today_queue_task_runs
         SET status='active',
             bot_key=?,
             bot_user_id=?,
             dispatch_nonce=?,
             dispatch_channel_id=?,
             dispatch_message_id=?,
             dispatch_message_url=?,
             started_at=COALESCE(started_at, datetime('now')),
             error=NULL,
             updated_at=datetime('now')
       WHERE id=? AND item_id=? AND status='active'
    `).run(
      dispatch.target_bot || null,
      dispatch.target_bot_user_id || null,
      dispatch.nonce,
      dispatch.channel_id || null,
      dispatch.message_id || null,
      dispatch.message_url || null,
      taskRunId,
      itemId,
    );
    if (taskUpdate.changes !== 1) throw new Error(`task run ${taskRunId} is not active`);

    const itemUpdate = db.prepare(`
      UPDATE items
         SET status='in_progress',
             dispatch_nonce=?,
             dispatch_message_id=?,
             dispatch_channel_id=?,
             dispatch_message_url=?,
             dispatch_target_bot_key=?,
             dispatch_target_bot_user_id=?,
             dispatch_started_at=datetime('now'),
             dispatch_attempt_count=COALESCE(dispatch_attempt_count,0)+1,
             dispatch_last_error=NULL,
             current_task_run_id=?
       WHERE id=? AND status='todo'
    `).run(
      dispatch.nonce,
      dispatch.message_id || null,
      dispatch.channel_id || null,
      dispatch.message_url || null,
      dispatch.target_bot || null,
      dispatch.target_bot_user_id || null,
      taskRunId,
      itemId,
    );
    if (itemUpdate.changes !== 1) throw new Error(`item #${itemId} is not dispatchable`);
    return getTaskRunStatement.get(taskRunId);
  });

  function recordDispatchSuccess(payload) {
    return recordDispatchSuccessTransaction(payload);
  }

  function recordDispatchFailure({ taskRunId, error }) {
    if (!taskRunId) return null;
    db.prepare(`
      UPDATE today_queue_task_runs
         SET status='failed',
             error=?,
             updated_at=datetime('now')
       WHERE id=? AND status='active'
    `).run(asErrorMessage(error), taskRunId);
    return getTaskRunStatement.get(taskRunId) || null;
  }

  const acceptResultTransaction = db.transaction(({
    itemId,
    nonce,
    resultMessageId,
    resultMessageUrl,
    gitCommit,
  }) => {
    const item = db.prepare("SELECT * FROM items WHERE id=?").get(itemId);
    if (!item || !["in_progress", "todo"].includes(item.status) || item.dispatch_nonce !== nonce) {
      return { changes: 0 };
    }

    const itemUpdate = db.prepare(`
      UPDATE items
         SET status='review',
             review_count=COALESCE(review_count,0)+1,
             review_emoji='👀',
             updated_at=datetime('now'),
             dispatch_last_error=NULL
       WHERE id=?
         AND status IN ('in_progress','todo')
         AND dispatch_nonce=?
    `).run(itemId, nonce);
    if (itemUpdate.changes !== 1) return { changes: 0 };

    let taskRun = null;
    if (item.current_task_run_id) {
      const taskUpdate = db.prepare(`
        UPDATE today_queue_task_runs
           SET status='review',
               result_message_id=?,
               result_message_url=?,
               git_commit=?,
               completed_at=datetime('now'),
               error=NULL,
               updated_at=datetime('now')
         WHERE id=?
           AND item_id=?
           AND status='active'
           AND dispatch_nonce=?
      `).run(
        resultMessageId || null,
        resultMessageUrl || null,
        gitCommit || null,
        item.current_task_run_id,
        itemId,
        nonce,
      );
      if (taskUpdate.changes !== 1) {
        throw new Error(`active task run linkage mismatch for item #${itemId}`);
      }
      taskRun = getTaskRunStatement.get(item.current_task_run_id);
    }

    return {
      changes: 1,
      run_id: taskRun?.run_id || null,
      task_run_id: taskRun?.id || null,
    };
  });

  function acceptResult(payload) {
    return acceptResultTransaction(payload);
  }

  const completeRunTransaction = db.transaction((projectId) => {
    const run = getCurrentRun(projectId);
    if (!run) return null;
    db.prepare(`
      UPDATE today_queue_task_runs
         SET status='skipped',
             completed_at=datetime('now'),
             updated_at=datetime('now')
       WHERE run_id=? AND status='pending'
    `).run(run.id);
    db.prepare(`
      UPDATE today_queue_runs
         SET status='completed',
             completed_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=? AND status='running'
    `).run(run.id);
    db.prepare(`
      UPDATE items
         SET current_task_run_id=NULL
       WHERE current_task_run_id IN (
         SELECT id FROM today_queue_task_runs WHERE run_id=?
       )
    `).run(run.id);
    db.prepare("UPDATE projects SET current_run_id=NULL WHERE id=? AND current_run_id=?")
      .run(projectId, run.id);
    return getRunStatement.get(run.id);
  });

  function completeRun(projectId) {
    return completeRunTransaction(projectId);
  }

  const stopProjectTransaction = db.transaction(({ projectId, activeItems }) => {
    const run = getCurrentRun(projectId);
    const stopItem = db.prepare(`
      UPDATE items
         SET status='todo',
             dispatch_nonce=NULL,
             dispatch_started_at=NULL,
             dispatch_last_error=?
       WHERE id=? AND project_id=? AND status='in_progress'
    `);
    let stopped = 0;
    for (const item of activeItems) {
      const result = stopItem.run("today queue stopped", item.id, projectId);
      stopped += result.changes;
    }

    if (run) {
      db.prepare(`
        UPDATE today_queue_task_runs
           SET status='stopped',
               stopped_at=datetime('now'),
               updated_at=datetime('now')
         WHERE run_id=? AND status='active'
      `).run(run.id);
      db.prepare(`
        UPDATE today_queue_task_runs
           SET status='skipped',
               stopped_at=datetime('now'),
               updated_at=datetime('now')
         WHERE run_id=? AND status='pending'
      `).run(run.id);
      db.prepare(`
        UPDATE today_queue_runs
           SET status='stopped',
               stopped_at=datetime('now'),
               updated_at=datetime('now')
         WHERE id=? AND status='running'
      `).run(run.id);
      db.prepare(`
        UPDATE items
           SET current_task_run_id=NULL
         WHERE current_task_run_id IN (
           SELECT id FROM today_queue_task_runs WHERE run_id=?
         )
      `).run(run.id);
      db.prepare("UPDATE projects SET current_run_id=NULL WHERE id=? AND current_run_id=?")
        .run(projectId, run.id);
    }

    return { project_id: projectId, stopped, run_id: run?.id || null };
  });

  function stopProject(payload) {
    return stopProjectTransaction(payload);
  }

  return {
    getCurrentRun,
    getCurrentTaskRun,
    getRunningProjectIds,
    ensureRun,
    beginAttempt,
    recordDispatchSuccess,
    recordDispatchFailure,
    acceptResult,
    completeRun,
    stopProject,
  };
}

module.exports = {
  createTodayQueueRunLifecycle,
};
