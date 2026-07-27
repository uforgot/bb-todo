function markerStatusIsReadyForReview(status) {
  return String(status || "").trim().toLowerCase() === "ready_for_review";
}

function markerRunIdIsTodayQueue(runId) {
  return String(runId || "").trim().toLowerCase() === "today-queue";
}

function messageChannelMatchesDispatch(msg, item) {
  if (!item.dispatch_channel_id) return false;
  if (msg.channelId === item.dispatch_channel_id) return true;
  if (msg.channel?.id === item.dispatch_channel_id) return true;
  if (msg.channel?.parentId === item.dispatch_channel_id) return true;
  return false;
}

function createTodayQueueResultHandler({
  getItemById,
  validateGitCommitDeclaration,
  markItemReview,
  acceptResult = null,
  dispatchNext,
  broadcast,
}) {
  return async function handleTodayQueueResultMarkerMessage(msg, marker) {
    const ignore = (reason, extra = {}) => ({ accepted: false, reason, ...extra });

    if (!msg?.author?.bot) return ignore("author_not_bot");
    if (!markerRunIdIsTodayQueue(marker.run_id)) return ignore("run_id_mismatch");
    if (!markerStatusIsReadyForReview(marker.status)) return ignore("status_not_ready_for_review");
    if (!Number.isInteger(marker.item_id)) return ignore("item_id_missing");
    if (!marker.nonce) return ignore("nonce_missing");
    const gitCommitValidation = validateGitCommitDeclaration(marker.raw);
    if (!gitCommitValidation.valid) return ignore(gitCommitValidation.reason);

    const item = getItemById(marker.item_id);
    if (!item) return ignore("item_not_found", { item_id: marker.item_id });
    if (msg.id && item.dispatch_message_id && msg.id === item.dispatch_message_id) return ignore("dispatch_prompt_message");
    // A generic item PATCH can restore a dispatched task to todo without clearing its
    // dispatch nonce. The matching nonce, bot, and channel still prove this result
    // belongs to the current dispatch. An intentional queue stop clears the nonce.
    if (item.status !== "in_progress" && item.status !== "todo") {
      return ignore("item_not_in_progress", { item_id: item.id, status: item.status });
    }
    if (item.owner !== "AI" || !item.is_today) return ignore("item_not_active_today_ai", { item_id: item.id });
    if (!item.dispatch_nonce || item.dispatch_nonce !== marker.nonce) return ignore("nonce_mismatch", { item_id: item.id });
    if (!item.dispatch_target_bot_user_id) return ignore("expected_bot_missing", { item_id: item.id });
    if (item.dispatch_target_bot_user_id !== msg.author.id) {
      return ignore("author_mismatch", {
        item_id: item.id,
        expected_author_id: item.dispatch_target_bot_user_id,
        actual_author_id: msg.author.id,
      });
    }
    if (!messageChannelMatchesDispatch(msg, item)) {
      return ignore("channel_mismatch", {
        item_id: item.id,
        expected_channel_id: item.dispatch_channel_id,
        actual_channel_id: msg.channelId,
      });
    }

    const updated = acceptResult
      ? acceptResult({
        item,
        marker,
        msg,
        gitCommit: gitCommitValidation.declaration?.type === "commit"
          ? gitCommitValidation.declaration.sha
          : null,
      })
      : markItemReview(item.id, marker.nonce);
    if (updated.changes !== 1) return ignore("duplicate_or_stale", { item_id: item.id });

    broadcast("today-queue", {
      action: "result",
      projectId: item.project_id,
      itemId: item.id,
      messageId: msg.id,
      authorId: msg.author.id,
    });
    broadcast("items-changed", {
      action: "today-queue-result",
      projectId: item.project_id,
      itemId: item.id,
    });

    const next = await dispatchNext(item.project_id, {
      startedBy: "result-marker",
      runId: updated.run_id || null,
    });
    const nextItemId = next.dispatch?.item_id || next.item?.id || null;
    broadcast("today-queue", {
      action: "next-after-result",
      projectId: item.project_id,
      previousItemId: item.id,
      started: next.started,
      reason: next.reason,
      itemId: nextItemId,
    });
    if (next.started || next.reason === "missing_discord_target" || next.reason === "dispatch_failed") {
      broadcast("items-changed", {
        action: "today-queue-next",
        projectId: item.project_id,
        reason: next.reason,
        itemId: nextItemId,
      });
    }

    return {
      accepted: true,
      item_id: item.id,
      project_id: item.project_id,
      run_id: updated.run_id || null,
      task_run_id: updated.task_run_id || null,
      next,
    };
  };
}

module.exports = {
  markerStatusIsReadyForReview,
  markerRunIdIsTodayQueue,
  messageChannelMatchesDispatch,
  createTodayQueueResultHandler,
};
