import { beforeEach, describe, expect, it } from "@jest/globals";
import { claudeCode } from "../../server/engine/claude-code";
import { RunSession } from "../../server/run-session";

let session: RunSession;

beforeEach(() => {
  session = new RunSession("demo-instructions", { status: "running" });
});

describe("instructions sent from the conversation", () => {
  it("should confirm the local echo once Claude Code records it", () => {
    session.conversationMessage({ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "reste sur desktop", pending: true });
    expect(session.state.messages).toEqual([{ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "reste sur desktop", pending: true }]);

    session.conversationMessage({ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "reste sur desktop" });
    expect(session.state.messages).toEqual([{ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "reste sur desktop" }]);
  });

  it("should confirm the local echo of an instruction the console pasted", () => {
    session.conversationMessage({ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "reste sur desktop", pending: true });
    const recorded = claudeCode.conversationLine(JSON.stringify({
      type: "user", uuid: "uuid-1", timestamp: "2026-09-07T11:55:27.000Z",
      message: { role: "user", content: "<pasted_content id=\"06f1\">\nreste sur desktop\n</pasted_content id=\"06f1\">" },
    }));
    session.conversationMessage(recorded!);
    expect(session.state.messages).toEqual([{ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "reste sur desktop" }]);
  });

  it("should keep two instructions that only look alike", () => {
    session.conversationMessage({ id: "local-1", at: "2026-09-07T11:54:08.000Z", author: "user", text: "teste avec la commande", pending: true });
    session.conversationMessage({ id: "uuid-1", at: "2026-09-07T11:55:27.000Z", author: "user", text: "teste avec la question", pending: false });
    expect(session.state.messages.map((message: { id: string }) => message.id)).toEqual(["local-1", "uuid-1"]);
  });

  it("should never fold two messages from Claude together", () => {
    session.conversationMessage({ id: "uuid-1", at: "2026-09-07T11:54:08.000Z", author: "claude", text: "J'attends le plan." });
    session.conversationMessage({ id: "uuid-2", at: "2026-09-07T11:55:27.000Z", author: "claude", text: "J'attends le plan." });
    expect(session.state.messages).toHaveLength(2);
  });
});
