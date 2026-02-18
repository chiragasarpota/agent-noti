#!/usr/bin/env node
/**
 * Records the current timestamp to ~/.agent-noti/last-prompt.
 * Called by the PromptSubmit hook so play.mjs can measure task duration.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const dir = join(homedir(), ".agent-noti");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "last-prompt"), String(Date.now()));
