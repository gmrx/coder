import type { AssistantConfig } from '../../core/types';
import type { McpInspectionSnapshot } from '../mcpInspector';
import type { SettingsModelIssue, SettingsSectionId } from '../modelSelectionIssue';
import type { ModelTestResult, SettingsPayload } from '../settingsModels';

export interface SettingsDataPayload extends AssistantConfig {
  models: string[];
  mcpConfigExists: boolean;
  mcpSource: 'settings' | 'none';
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
  ok?: boolean;
  error?: string;
  silent?: boolean;
}

export interface ConnectionResultMessage {
  type: 'connectionResult';
  ok: boolean;
  error: string;
  models: string[];
  modelsCount: number;
  silent?: boolean;
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

export interface JiraCheckProjectPayload {
  key: string;
  name: string;
  taskCount: number;
  url: string;
  tasks: JiraCheckTaskPayload[];
}

export interface JiraCheckTaskPayload {
  key: string;
  title: string;
  description: string;
  url: string;
}

export interface JiraCheckResultMessage {
  type: 'jiraCheckResult';
  ok: boolean;
  error: string;
  authUser: string;
  authMode: 'anonymous' | 'basic';
  baseUrl: string;
  projectsCount: number;
  totalTasks: number;
  projects: JiraCheckProjectPayload[];
  warning?: string;
}

export interface TfsCheckProjectPayload {
  id: string;
  key: string;
  name: string;
  description: string;
  taskCount: number;
  url: string;
  tasks: TfsCheckTaskPayload[];
}

export interface TfsCheckTaskPayload {
  id: number;
  key: string;
  title: string;
  description: string;
  url: string;
  status: string;
  type: string;
  projectName: string;
}

export interface TfsCheckResultMessage {
  type: 'tfsCheckResult';
  ok: boolean;
  error: string;
  authUser: string;
  authMode: 'anonymous' | 'basic';
  baseUrl: string;
  collection: string;
  effectiveUsername: string;
  projectsCount: number;
  totalTasks: number;
  projects: TfsCheckProjectPayload[];
  warning?: string;
}

export type SettingsRequestPayload = SettingsPayload;
