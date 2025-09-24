/// <reference path="../types/deno.d.ts" />

import {
  loadPyodide,
  version as pyodideVersion,
  type PyodideInterface,
} from "pyodide";
import process from "node:process";

let pyodideInstance: Promise<PyodideInterface> | null = null;
let initializationAttempted = false;

export const getPyodide = async (): Promise<PyodideInterface> => {
  if (!pyodideInstance && !initializationAttempted) {
    initializationAttempted = true;
    
    console.log("[py] Starting Pyodide initialization...");
    
    // Support custom package download source (e.g., using private mirror)
    // Can be specified via environment variable PYODIDE_PACKAGE_BASE_URL
    const customPackageBaseUrl = process.env.PYODIDE_PACKAGE_BASE_URL;
    const packageBaseUrl = customPackageBaseUrl
      ? `${customPackageBaseUrl.replace(/\/$/, "")}/` // Ensure trailing slash
      : `https://fastly.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;

    console.log("[py] Using Pyodide package base URL:", packageBaseUrl);
    
    pyodideInstance = Promise.race([
      loadPyodide({
        // TODO: will be supported when v0.28.1 is released: https://github.com/pyodide/pyodide/commit/7be415bd4e428dc8e36d33cfc1ce2d1de10111c4
        // @ts-ignore: Pyodide types may not include all configuration options
        packageBaseUrl,
        stdout: (msg: string) => console.log("[pyodide stdout]", msg),
        stderr: (msg: string) => console.warn("[pyodide stderr]", msg),
      }),
      // Add timeout for initialization to prevent hanging
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Pyodide initialization timeout (60 seconds)"));
        }, 60000);
      })
    ]);
    
    try {
      const pyodide = await pyodideInstance;
      console.log("[py] Pyodide initialized successfully");
      return pyodide;
    } catch (error) {
      console.error("[py] Pyodide initialization failed:", error);
      pyodideInstance = null;
      initializationAttempted = false;
      throw new Error(`Pyodide initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else if (pyodideInstance) {
    return pyodideInstance;
  } else {
    throw new Error("Pyodide initialization already attempted and failed");
  }
};

export const getPip = async () => {
  const pyodide = await getPyodide();
  await pyodide.loadPackage("micropip", { messageCallback: () => {} });
  const micropip = pyodide.pyimport("micropip");
  return micropip;
};

export const loadDeps = async (
  code: string,
  importToPackageMap: Record<string, string> = {}
) => {
  const pyodide = await getPyodide();

  // Merge user-provided mapping with default mapping
  const defaultMappings: Record<string, string> = {
    sklearn: "scikit-learn",
    cv2: "opencv-python",
    PIL: "Pillow",
    bs4: "beautifulsoup4",
  };

  const combinedMap: Record<string, string> = {
    ...defaultMappings,
    ...importToPackageMap,
  };

  try {
    // Optimized approach for code analysis with better performance
    const analysisCode = `
import pyodide, sys
try:
    # Find all imports in the code
    imports_found = pyodide.code.find_imports(${JSON.stringify(code)})
    
    # Get currently available modules (faster than checking all possible sources)
    available_modules = set(sys.modules.keys())
    
    # Add known built-in modules
    available_modules.update(sys.builtin_module_names)
    
    # Extract root packages and check availability
    missing_imports = []
    checked_packages = set()
    
    for imp in imports_found:
        root_package = imp.split('.')[0]
        
        # Skip if we've already checked this package
        if root_package in checked_packages:
            continue
        checked_packages.add(root_package)
        
        # Quick check: if root package is in available modules, skip
        if root_package in available_modules:
            continue
            
        # Try importing to confirm it's missing
        try:
            exec(f"import {root_package}")
            # If successful, add to available modules for future checks
            available_modules.add(root_package)
        except ImportError:
            missing_imports.append(root_package)
        except Exception:
            # If any other error (like syntax issues), treat as missing
            missing_imports.append(root_package)
    
    # Return sorted unique missing imports
    result = sorted(list(set(missing_imports)))
    
except Exception as e:
    print(f"Warning: Could not analyze imports: {e}")
    result = []

result`;

    const imports = pyodide.runPython(analysisCode).toJs();

    const pip = await getPip();
    if (imports && imports.length > 0) {
      // Map import names to package names, handling dot notation
      const packagesToInstall = imports.map((importName: string) => {
        return combinedMap[importName] || importName;
      });

      // Remove duplicates and filter out empty strings
      const uniquePackages = [...new Set(packagesToInstall)].filter(
        (pkg) => typeof pkg === "string" && pkg.trim().length > 0
      );

      if (uniquePackages.length === 0) {
        console.log("[py] No packages to install after mapping");
        return;
      }

      console.log("[py] Found missing imports:", imports);
      console.log("[py] Installing packages:", uniquePackages);

      // Try batch installation first for better performance
      try {
        await pip.install(uniquePackages);
        console.log(
          `[py] Successfully installed all packages: ${uniquePackages.join(
            ", "
          )}`
        );
      } catch (_batchError) {
        console.warn(
          "[py] Batch installation failed, trying individual installation"
        );

        // Fall back to individual installation
        for (const pkg of uniquePackages) {
          try {
            await pip.install(pkg);
            console.log(`[py] Successfully installed: ${pkg}`);
          } catch (error) {
            console.warn(`[py] Failed to install ${pkg}:`, error);
            // Continue with other packages
          }
        }
      }
    } else {
      console.log("[py] No missing imports detected");
    }
  } catch (error) {
    // If dependency loading fails, log but don't fail completely
    console.warn("[py] Failed to load dependencies:", error);
    // Continue execution without external dependencies
  }
};

/**
 * Create a ReadableStream wired up with abort-handling.
 *
 * `onAbort` may be supplied to perform additional cleanup
 * (e.g. kill a child process, set Pyodide interrupt buffer, …).
 */
export function makeStream(
  abortSignal: AbortSignal | undefined,
  onStart: (controller: ReadableStreamDefaultController<Uint8Array>) => void,
  onAbort?: () => void
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onStart(controller);

      if (abortSignal) {
        // If already aborted – trigger immediately
        if (abortSignal.aborted) {
          controller.error(
            abortSignal.reason ?? new Error("Operation aborted")
          );
          onAbort?.();
          return;
        }

        // Otherwise listen for future aborts
        abortSignal.addEventListener(
          "abort",
          () => {
            controller.error(
              abortSignal.reason ?? new Error("Operation aborted")
            );
            onAbort?.();
          },
          { once: true }
        );
      }
    },
  });
}
