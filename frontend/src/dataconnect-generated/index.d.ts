import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface ConversationSession_Key {
  id: UUIDString;
  __typename?: 'ConversationSession_Key';
}

export interface ConversationUtterance_Key {
  id: UUIDString;
  __typename?: 'ConversationUtterance_Key';
}

export interface CreateNewScenarioData {
  scenario_insert: Scenario_Key;
}

export interface CreateNewScenarioVariables {
  description: string;
  difficultyLevel: number;
  title: string;
}

export interface GetUserConversationSessionsData {
  conversationSessions: ({
    id: UUIDString;
    startTime: TimestampString;
    endTime?: TimestampString | null;
    durationMinutes: number;
    feedbackSummary?: string | null;
    scenario: {
      id: UUIDString;
      title: string;
      description: string;
    } & Scenario_Key;
  } & ConversationSession_Key)[];
}

export interface GetUserConversationSessionsVariables {
  userId: UUIDString;
}

export interface ListScenariosData {
  scenarios: ({
    id: UUIDString;
    title: string;
    description: string;
    difficultyLevel: number;
  } & Scenario_Key)[];
}

export interface ProficiencyAssessment_Key {
  id: UUIDString;
  __typename?: 'ProficiencyAssessment_Key';
}

export interface Scenario_Key {
  id: UUIDString;
  __typename?: 'Scenario_Key';
}

export interface UpdateFeedbackSummaryData {
  conversationSession_update?: ConversationSession_Key | null;
}

export interface UpdateFeedbackSummaryVariables {
  conversationSessionId: UUIDString;
  feedbackSummary?: string | null;
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

interface CreateNewScenarioRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewScenarioVariables): MutationRef<CreateNewScenarioData, CreateNewScenarioVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateNewScenarioVariables): MutationRef<CreateNewScenarioData, CreateNewScenarioVariables>;
  operationName: string;
}
export const createNewScenarioRef: CreateNewScenarioRef;

export function createNewScenario(vars: CreateNewScenarioVariables): MutationPromise<CreateNewScenarioData, CreateNewScenarioVariables>;
export function createNewScenario(dc: DataConnect, vars: CreateNewScenarioVariables): MutationPromise<CreateNewScenarioData, CreateNewScenarioVariables>;

interface ListScenariosRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListScenariosData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListScenariosData, undefined>;
  operationName: string;
}
export const listScenariosRef: ListScenariosRef;

export function listScenarios(): QueryPromise<ListScenariosData, undefined>;
export function listScenarios(dc: DataConnect): QueryPromise<ListScenariosData, undefined>;

interface UpdateFeedbackSummaryRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateFeedbackSummaryVariables): MutationRef<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateFeedbackSummaryVariables): MutationRef<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;
  operationName: string;
}
export const updateFeedbackSummaryRef: UpdateFeedbackSummaryRef;

export function updateFeedbackSummary(vars: UpdateFeedbackSummaryVariables): MutationPromise<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;
export function updateFeedbackSummary(dc: DataConnect, vars: UpdateFeedbackSummaryVariables): MutationPromise<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;

interface GetUserConversationSessionsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetUserConversationSessionsVariables): QueryRef<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetUserConversationSessionsVariables): QueryRef<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
  operationName: string;
}
export const getUserConversationSessionsRef: GetUserConversationSessionsRef;

export function getUserConversationSessions(vars: GetUserConversationSessionsVariables): QueryPromise<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
export function getUserConversationSessions(dc: DataConnect, vars: GetUserConversationSessionsVariables): QueryPromise<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;

