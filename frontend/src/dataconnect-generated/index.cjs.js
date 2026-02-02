const { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'example',
  service: 'lingual-project',
  location: 'us-east1'
};
exports.connectorConfig = connectorConfig;

const createNewScenarioRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateNewScenario', inputVars);
}
createNewScenarioRef.operationName = 'CreateNewScenario';
exports.createNewScenarioRef = createNewScenarioRef;

exports.createNewScenario = function createNewScenario(dcOrVars, vars) {
  return executeMutation(createNewScenarioRef(dcOrVars, vars));
};

const listScenariosRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListScenarios');
}
listScenariosRef.operationName = 'ListScenarios';
exports.listScenariosRef = listScenariosRef;

exports.listScenarios = function listScenarios(dc) {
  return executeQuery(listScenariosRef(dc));
};

const updateFeedbackSummaryRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateFeedbackSummary', inputVars);
}
updateFeedbackSummaryRef.operationName = 'UpdateFeedbackSummary';
exports.updateFeedbackSummaryRef = updateFeedbackSummaryRef;

exports.updateFeedbackSummary = function updateFeedbackSummary(dcOrVars, vars) {
  return executeMutation(updateFeedbackSummaryRef(dcOrVars, vars));
};

const getUserConversationSessionsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetUserConversationSessions', inputVars);
}
getUserConversationSessionsRef.operationName = 'GetUserConversationSessions';
exports.getUserConversationSessionsRef = getUserConversationSessionsRef;

exports.getUserConversationSessions = function getUserConversationSessions(dcOrVars, vars) {
  return executeQuery(getUserConversationSessionsRef(dcOrVars, vars));
};
