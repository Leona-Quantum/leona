import assert from "node:assert/strict";
import test from "node:test";

import { collapseConversationChats } from "./chat-history.ts";

test("follow-up runs keep one sidebar conversation and preserve its owner-facing identity", () => {
  const chats = collapseConversationChats([
    {
      id: "turn-two",
      conversationId: "conversation-a",
      title: "Follow-up question",
      prompt: "Can you add a measurement?",
      createdAt: "2026-07-23T10:10:00.000Z",
      status: "queued",
    },
    {
      id: "turn-one",
      conversationId: "conversation-a",
      title: "Bell-state work",
      titleOverride: "Bell-state analysis",
      prompt: "Build a Bell state and verify it.",
      createdAt: "2026-07-23T10:00:00.000Z",
      status: "draft",
      folderId: "research",
    },
    {
      id: "separate-chat",
      conversationId: "conversation-b",
      title: "QFT resources",
      prompt: "Estimate a QFT.",
      createdAt: "2026-07-23T10:05:00.000Z",
      status: "verified",
    },
  ]);

  assert.equal(chats.length, 2);
  const conversation = chats.find((chat) => chat.conversationId === "conversation-a");
  assert.ok(conversation);
  assert.equal(conversation.id, "turn-one");
  assert.equal(conversation.title, "Bell-state analysis");
  assert.equal(conversation.prompt, "Build a Bell state and verify it.");
  assert.equal(conversation.folderId, "research");
  assert.equal(conversation.status, "queued");
});
