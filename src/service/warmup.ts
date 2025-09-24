// Pre-warming strategy for cloud deployment
/// <reference path="../types/pyodide.d.ts" />

import { getPyodide, loadDeps } from "../tool/py.ts";
import { CONFIG } from "../config.ts";

let warmupCompleted = false;
let warmupPromise: Promise<void> | null = null;

/**
 * Pre-warm Python environment with common packages
 * This runs during server startup to reduce first-request latency
 */
export const warmupPython = async (): Promise<void> => {
  if (warmupCompleted || warmupPromise) {
    return warmupPromise || Promise.resolve();
  }

  console.log("[warmup] Starting Python environment pre-warming...");
  
  warmupPromise = (async () => {
    try {
      // Initialize Pyodide first
      console.log("[warmup] Initializing Pyodide...");
      await getPyodide();
      
      // Pre-load common packages that are frequently used
      const commonPackagesCode = `
# Common imports for email processing and data science
import sys
import os
import re
import json
import string
import nltk
from sklearn.feature_extraction.text import CountVectorizer
`;

      console.log("[warmup] Pre-loading common packages...");
      
      // Use a timeout for warmup to avoid blocking server startup
      const warmupTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Warmup timeout")), CONFIG.TIMEOUTS.PACKAGE_LOADING);
      });
      
      const warmupTask = loadDeps(commonPackagesCode);
      
      try {
        await Promise.race([warmupTask, warmupTimeout]);
        console.log("[warmup] Python environment pre-warming completed successfully");
        warmupCompleted = true;
      } catch (error) {
        console.warn("[warmup] Python pre-warming timed out, but server will continue:", error);
        // Don't fail server startup if warmup times out
        warmupCompleted = false;
      }
      
    } catch (error) {
      console.warn("[warmup] Python pre-warming failed, but server will continue:", error);
      warmupCompleted = false;
    }
  })();
  
  return warmupPromise;
};

/**
 * Check if warmup is completed
 */
export const isWarmupCompleted = (): boolean => {
  return warmupCompleted;
};

/**
 * Get warmup status for health checks
 */
export const getWarmupStatus = (): { completed: boolean; inProgress: boolean } => {
  return {
    completed: warmupCompleted,
    inProgress: warmupPromise !== null && !warmupCompleted
  };
};