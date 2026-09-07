import { beforeEach, describe, expect, it } from "@jest/globals";
import { conversationMessage, ctx, emptyState } from "../../server/context";

beforeEach(() => {
  ctx.state = { ...emptyState(), id: "demo-instructions", status: "running" };
});

describe("instructions sent from the conversation", () => {
  it("should confirm the local echo once Claude Code records it", () => {
    conversationMessage({ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "reste sur desktop", pending: true });
    expect(ctx.state.messages).toEqual([{ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "reste sur desktop", pending: true }]);

    conversationMessage({ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "reste sur desktop" });
    expect(ctx.state.messages).toEqual([{ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "reste sur desktop" }]);
  });

  it("should keep two instructions that only look alike", () => {
    conversationMessage({ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "teste avec la commande", pending: true });
    conversationMessage({ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "teste avec la question", pending: false });
    expect(ctx.state.messages.map((message) => message.id)).toEqual(["local-1", "uuid-1"]);
  });

  it("should never fold two messages from Claude together", () => {
    conversationMessage({ id: "uuid-1", at: "2026-09-07T11:54:08.000Z", author: "claude", text: "J'attends le plan." });
    conversationMessage({ id: "uuid-2", at: "2026-09-07T11:55:27.000Z", author: "claude", text: "J'attends le plan." });
    expect(ctx.state.messages).toHaveLength(2);
  });
});
