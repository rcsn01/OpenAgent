/* This file replaces the deleted SST-generated app env stub with the Vite ambient types the app still needs. */

/// <reference types="vite/client" />

interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv
}