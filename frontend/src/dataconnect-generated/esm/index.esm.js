import { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'example',
  service: 'lingual-project',
  location: 'us-east1'
};

export const createNewScenarioRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateNewScenario', inputVars);
}
createNewScenarioRef.operationName = 'CreateNewScenario';

export function createNewScenario(dcOrVars, vars) {
  return executeMutation(createNewScenarioRef(dcOrVars, vars));
}

export const listScenariosRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListScenarios');
}
listScenariosRef.operationName = 'ListScenarios';

export function listScenarios(dc) {
  return executeQuery(listScenariosRef(dc));
}

export const updateFeedbackSummaryRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateFeedbackSummary', inputVars);
}
updateFeedbackSummaryRef.operationName = 'UpdateFeedbackSummary';

export function updateFeedbackSummary(dcOrVars, vars) {
  return executeMutation(updateFeedbackSummaryRef(dcOrVars, vars));
}

export const getUserConversationSessionsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetUserConversationSessions', inputVars);
}
getUserConversationSessionsRef.operationName = 'GetUserConversationSessions';

export function getUserConversationSessions(dcOrVars, vars) {
  return executeQuery(getUserConversationSessionsRef(dcOrVars, vars));
}

