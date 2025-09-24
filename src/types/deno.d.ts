// Deno-specific type declarations

// Fix for import.meta.main
declare namespace ImportMeta {
  var main: boolean;
}

// Fix for node: imports in Deno
declare module "node:process" {
  const process: {
    env: Record<string, string | undefined>;
    exit(code?: number): never;
    argv: string[];
    cwd(): string;
  };
  export default process;
}

// Pyodide type declarations
declare module "pyodide" {
  export interface PyodideInterface {
    loadPackage(packages: string | string[], options?: { messageCallback?: () => void }): Promise<void>;
    runPython(code: string): any;
    pyimport(name: string): any;
    globals: any;
    registerJsModule(name: string, module: any): void;
    unpackArchive(buffer: ArrayBuffer, format: string): void;
    FS: any;
    code: {
      find_imports(code: string): string[];
    };
  }

  export function loadPyodide(options?: {
    packageBaseUrl?: string;
    stdout?: (msg: string) => void;
    stderr?: (msg: string) => void;
    [key: string]: any;
  }): Promise<PyodideInterface>;

  export const version: string;
}