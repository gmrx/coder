import type { AssistantConfig } from '../../core/types';
import type { McpInspectionSnapshot } from '../mcpInspector';
import type { SettingsModelIssue, SettingsSectionId } from '../modelSelectionIssue';
import type { ModelTestResult, SettingsPayload } from '../settingsModels';

export interface SettingsDataPayload extends AssistantConfig {
  models: string[];
  mcpConfigExists: boolean;
  mcpSource: 'workspace-file' | 'settings' | 'none';
  mcpSourceLabel: string;
  mcpLoadError: string;
  settingsSection?: SettingsSectionId;
  modelSelectionIssue: SettingsModelIssue | null;
  highlightModelSelectionIssue?: boolean;
}

export interface SettingsDataMessage {
  type: 'settingsData';
  data: SettingsDataPayload;
}

export interface SettingsSavedMessage {
  type: 'settingsSaved';
  mcpSavedPath?: string;
  mcpCreatedFile?: boolean;
}

export interface ConnectionResultMessage {
  type: 'connectionResult';
  ok: boolean;
  error: string;
  models: string[];
  modelsCount: number;
}

export interface ModelTestsResultMessage {
  type: 'modelTestsResult';
  ok: boolean;
  summary: string;
  tests: ModelTestResult[];
}

export interface McpInspectionResultMessage extends McpInspectionSnapshot {
  type: 'mcpInspectionResult';
}

export type SettingsRequestPayload = SettingsPayload;
