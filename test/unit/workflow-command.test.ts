// Workflow commands are escaped per GitHub's rules, so text from an upstream
// spec or a compiler cannot end an annotation early or start another command.

import { expect, test } from "bun:test";
import { escapeData, escapeProperty, workflowCommand } from "../../scripts/workflow-command.ts";

test("a message escapes %, CR and LF, in that order", () => {
  expect(escapeData("100% done\r\n::set-output name=x::y")).toBe("100%25 done%0D%0A::set-output name=x::y");
  expect(escapeData("%0A")).toBe("%250A");
});

test("a property also escapes : and ,", () => {
  expect(escapeProperty("a:b,c%\n")).toBe("a%3Ab%2Cc%25%0A");
});

test("a command line", () => {
  expect(workflowCommand("error", { title: "gc drift", file: "x,y" }, "line one\nline two")).toBe(
    "::error title=gc drift,file=x%2Cy::line one%0Aline two",
  );
  expect(workflowCommand("warning", {}, "plain")).toBe("::warning::plain");
});
