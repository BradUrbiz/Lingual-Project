/** Canvas LMS integration types. */

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode: string;
}

export interface CanvasTeacher {
  id: number;
  name: string;
}

export interface CanvasValidateResult {
  success: boolean;
  teacher: CanvasTeacher;
  courses: CanvasCourse[];
  error?: string;
}

export interface CanvasConnectResult {
  success: boolean;
  connectionId: string;
  classId: string;
  roster: CanvasSyncRosterResult | null;
  contentCount: number;
  error?: string;
}

export interface CanvasSyncRosterResult {
  matched: number;
  unmatched: number;
  deactivated: number;
  created: number;
  unchanged: number;
}

export interface CanvasConnectionStatus {
  connected: boolean;
  connectionId?: string;
  canvasInstanceUrl?: string;
  canvasCourseId?: string;
  canvasCourseName?: string;
  syncStatus?: 'never' | 'syncing' | 'completed' | 'error';
  lastSyncAt?: string | null;
}

export interface CanvasSyncResult {
  success: boolean;
  roster: CanvasSyncRosterResult;
  contentCount: number;
  error?: string;
}

export interface CanvasCourseContentItem {
  id: string;
  connectionId: string;
  classId: string;
  canvasModuleId: string;
  canvasModuleName: string;
  canvasModulePosition: number;
  canvasItemId: string;
  title: string;
  itemType: string;
  itemPosition: number;
  lingualAssignmentId?: string | null;
}
