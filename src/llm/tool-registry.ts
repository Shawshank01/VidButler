// Tools that an LLM agent may call. Each tool:
//  - declares a JSON-schema for its parameters (sent to the model),
//  - validates every parameter itself (the model is not trusted),
//  - builds yt-dlp / ffmpeg argument ARRAYS from validated values (never a shell string),
//  - delegates the media work to the Electron-free functions in ../core/tools.ts.
//
// The download folder, cookie browser and proxy come from the user's settings (the `ctx` object),
// never from the model, so the model cannot write outside the folder the user chose.
//
// The tools themselves are defined by group in ./tools/. This module only assembles and looks them up.
import { infoTools } from './tools/info.ts';
import { downloadTools } from './tools/download.ts';
import { downloadSectionTool } from './tools/section.ts';
import { videoTranscriptTool } from './tools/transcript.ts';
import { mediaTools } from './tools/media.ts';
import { fileTools } from './tools/files.ts';

export { TOOL_NAMES } from './tools/names.ts';

import type { Tool, ToolArguments, ToolRisk } from './tools/common.ts';
import type { ToolDeclaration } from './types.js';

export type { ToolContext } from './tools/common.ts';

export const TOOLS = [...infoTools, videoTranscriptTool, ...downloadTools, downloadSectionTool, ...mediaTools, ...fileTools];

const TOOL_BY_NAME = new Map<string, Tool>(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string) {
    return TOOL_BY_NAME.get(name);
}

/** Resolve a tool's risk level for the given arguments ('low' | 'high'). */
export function getRisk(tool: Tool, args: ToolArguments): ToolRisk {
    return typeof tool.risk === 'function' ? tool.risk(args || {}) : tool.risk;
}

/** Tool declarations in the neutral shape that providers translate to their own API format. */
export function getToolDeclarations(): ToolDeclaration[] {
    return TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}
