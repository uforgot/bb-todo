const MEETING_LIST_COLUMNS = Object.freeze([
  "id",
  "record_number",
  "recorded_at",
  "recorded_date",
  "title",
  "title_source",
  "summary",
  "speaker_names_json",
  "audio_path",
  "audio_deleted_at",
  "original_filename",
  "mime_type",
  "size_bytes",
  "duration_seconds",
  "sha256",
  "time_label",
  "location_label",
  "location_lat",
  "location_lng",
  "location_accuracy",
  "weather_label",
  "weather_observed_at",
  "transcription_status",
  "transcription_attempts",
  "transcription_error",
  "transcription_model",
  "transcription_id",
  "transcription_language",
  "transcription_language_probability",
  "transcription_duration_seconds",
  "transcription_updated_at",
  "summary_status",
  "summary_model",
  "summary_error",
  "summary_updated_at",
  "created_at",
  "updated_at",
]);

const MEETING_LIST_QUERY = `
  SELECT ${MEETING_LIST_COLUMNS.join(", ")}
    FROM meetings
   ORDER BY record_number DESC
   LIMIT ?
`;

module.exports = {
  MEETING_LIST_COLUMNS,
  MEETING_LIST_QUERY,
};
