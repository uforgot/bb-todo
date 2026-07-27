/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageType } = require("discord.js");
const { isRelayableMessageType } = require("./relay-bridge");

test("relays only normal user message types", () => {
  assert.equal(isRelayableMessageType({ type: MessageType.Default }), true);
  assert.equal(isRelayableMessageType({}), true);
  assert.equal(isRelayableMessageType({ type: MessageType.ThreadCreated }), false);
  assert.equal(isRelayableMessageType({ type: MessageType.ThreadStarterMessage }), false);
});
