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
    console.log("[py] Pyodide version:", pyodideVersion);
    
    // Use the default CDN that should work reliably
    // The issue might be with custom packageBaseUrl configuration
    console.log("[py] Using default Pyodide CDN configuration");
    
    try {
      pyodideInstance = loadPyodide({
        stdout: (msg: string) => console.log("[pyodide stdout]", msg),
        stderr: (msg: string) => console.warn("[pyodide stderr]", msg),
      });
      
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
  
  try {
    console.log("[py] Loading micropip package...");
    
    // Add timeout protection for micropip loading
    const micropipPromise = pyodide.loadPackage("micropip", { 
      messageCallback: () => {}
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Micropip loading timeout")), 30000);
    });
    
    await Promise.race([micropipPromise, timeoutPromise]);
    
    // Import micropip
    const micropip = pyodide.pyimport("micropip");
    console.log("[py] Micropip loaded successfully");
    return micropip;
    
  } catch (error) {
    console.error("[py] Failed to load micropip:", error);
    // Don't throw - return null to indicate micropip unavailable
    return null;
  }
};

export const loadDeps = async (
  code: string,
  importToPackageMap: Record<string, string> = {}
) => {
  // Wrap entire function in try-catch to prevent any crashes
  try {
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

    let imports;
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

      imports = pyodide.runPython(analysisCode).toJs();
    } catch (analysisError) {
      console.warn("[py] Import analysis failed, skipping dependency loading:", analysisError);
      return;
    }

    if (imports && imports.length > 0) {
      console.log("[py] Found missing imports:", imports);
      
      // Only load micropip when we actually need to install packages
      let pip;
      try {
        pip = await getPip();
        if (!pip) {
          console.log("[py] Micropip not available, skipping package installation");
          return;
        }
      } catch (pipError) {
        console.error("[py] Failed to load micropip, skipping package installation:", pipError);
        return;
      }
      
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

      console.log("[py] Installing packages:", uniquePackages);

      // Wrap package installation in timeout and error handling
      try {
        // Add timeout for package installation
        const installPromise = pip.install(uniquePackages);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Package installation timeout")), 60000);
        });
        
        await Promise.race([installPromise, timeoutPromise]);
        console.log(
          `[py] Successfully installed all packages: ${uniquePackages.join(
            ", "
          )}`
        );
      } catch (_batchError) {
        console.warn(
          "[py] Batch installation failed, trying individual installation"
        );

        // Fall back to individual installation with timeouts
        for (const pkg of uniquePackages) {
          try {
            const singleInstallPromise = pip.install(pkg);
            const singleTimeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error(`Installation timeout for ${pkg}`)), 30000);
            });
            
            await Promise.race([singleInstallPromise, singleTimeoutPromise]);
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
    // If dependency loading fails completely, log but don't fail completely
    console.error("[py] Dependency loading failed completely:", error);
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
