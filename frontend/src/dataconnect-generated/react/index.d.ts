/* eslint-disable @typescript-eslint/no-unused-vars */
import { CreateNewScenarioData, CreateNewScenarioVariables, ListScenariosData, UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables, GetUserConversationSessionsData, GetUserConversationSessionsVariables } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useCreateNewScenario(options?: useDataConnectMutationOptions<CreateNewScenarioData, FirebaseError, CreateNewScenarioVariables>): UseDataConnectMutationResult<CreateNewScenarioData, CreateNewScenarioVariables>;
export function useCreateNewScenario(dc: DataConnect, options?: useDataConnectMutationOptions<CreateNewScenarioData, FirebaseError, CreateNewScenarioVariables>): UseDataConnectMutationResult<CreateNewScenarioData, CreateNewScenarioVariables>;

export function useListScenarios(options?: useDataConnectQueryOptions<ListScenariosData>): UseDataConnectQueryResult<ListScenariosData, undefined>;
export function useListScenarios(dc: DataConnect, options?: useDataConnectQueryOptions<ListScenariosData>): UseDataConnectQueryResult<ListScenariosData, undefined>;

export function useUpdateFeedbackSummary(options?: useDataConnectMutationOptions<UpdateFeedbackSummaryData, FirebaseError, UpdateFeedbackSummaryVariables>): UseDataConnectMutationResult<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;
export function useUpdateFeedbackSummary(dc: DataConnect, options?: useDataConnectMutationOptions<UpdateFeedbackSummaryData, FirebaseError, UpdateFeedbackSummaryVariables>): UseDataConnectMutationResult<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;

export function useGetUserConversationSessions(vars: GetUserConversationSessionsVariables, options?: useDataConnectQueryOptions<GetUserConversationSessionsData>): UseDataConnectQueryResult<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
export function useGetUserConversationSessions(dc: DataConnect, vars: GetUserConversationSessionsVariables, options?: useDataConnectQueryOptions<GetUserConversationSessionsData>): UseDataConnectQueryResult<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
