export const developerSections = {
  permissions: '권한 관리',
  logs: '로그',
  security: '세션·보안',
  operations: '운영',
  system: '시스템',
} as const;
export type DevSection = keyof typeof developerSections;
export interface DevLocation { section: DevSection; item?: string; page?: number; search?: string }
export interface DevRow {
  title: string;
  detail?: string;
  value?: string;
  next?: DevLocation;
}
export interface DevField {
  key: string;
  label: string;
  value: string;
  options?: { value: string; label: string }[];
  multiple?: boolean;
}
export interface DevForm {
  label: string; command: string; id?: string; version?: number;
  message: string; destructive?: boolean; fields?: DevField[];
}
export interface DevView {
  title: string;
  groups: { title: string; rows: DevRow[] }[];
  forms?: DevForm[];
  searchLabel?: string;
  interval?: number;
  hasMore?: boolean;
}

export interface DevCommand {
  command: string;
  id?: string;
  version?: number;
  values?: Record<string, string>;
}
