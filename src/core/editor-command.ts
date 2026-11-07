// How to start your editor ($VISUAL) on a file, on a Mac, Linux and Windows alike.

export interface EditorCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Through the system's shell: Windows' editors are often .cmd files (code.cmd), which only cmd starts. */
  readonly shell: boolean;
}

/**
 * `editor file`: as it is on a Mac and Linux; on Windows through cmd, the file in double quotes (a
 * Windows path can't hold one) so a folder with a space stays one argument.
 */
export const editorCommand = (editor: string, file: string, platform: NodeJS.Platform = process.platform): EditorCommand =>
  platform === 'win32' ? { command: editor, args: [`"${file}"`], shell: true } : { command: editor, args: [file], shell: false };
