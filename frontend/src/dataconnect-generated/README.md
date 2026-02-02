# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `example`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

**If you're looking for the `React README`, you can find it at [`dataconnect-generated/react/README.md`](./react/README.md)**

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*ListScenarios*](#listscenarios)
  - [*GetUserConversationSessions*](#getuserconversationsessions)
- [**Mutations**](#mutations)
  - [*CreateNewScenario*](#createnewscenario)
  - [*UpdateFeedbackSummary*](#updatefeedbacksummary)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `example`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@dataconnect/generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## ListScenarios
You can execute the `ListScenarios` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listScenarios(): QueryPromise<ListScenariosData, undefined>;

interface ListScenariosRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListScenariosData, undefined>;
}
export const listScenariosRef: ListScenariosRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listScenarios(dc: DataConnect): QueryPromise<ListScenariosData, undefined>;

interface ListScenariosRef {
  ...
  (dc: DataConnect): QueryRef<ListScenariosData, undefined>;
}
export const listScenariosRef: ListScenariosRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listScenariosRef:
```typescript
const name = listScenariosRef.operationName;
console.log(name);
```

### Variables
The `ListScenarios` query has no variables.
### Return Type
Recall that executing the `ListScenarios` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListScenariosData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ListScenariosData {
  scenarios: ({
    id: UUIDString;
    title: string;
    description: string;
    difficultyLevel: number;
  } & Scenario_Key)[];
}
```
### Using `ListScenarios`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listScenarios } from '@dataconnect/generated';


// Call the `listScenarios()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listScenarios();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listScenarios(dataConnect);

console.log(data.scenarios);

// Or, you can use the `Promise` API.
listScenarios().then((response) => {
  const data = response.data;
  console.log(data.scenarios);
});
```

### Using `ListScenarios`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listScenariosRef } from '@dataconnect/generated';


// Call the `listScenariosRef()` function to get a reference to the query.
const ref = listScenariosRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listScenariosRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.scenarios);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.scenarios);
});
```

## GetUserConversationSessions
You can execute the `GetUserConversationSessions` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getUserConversationSessions(vars: GetUserConversationSessionsVariables): QueryPromise<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;

interface GetUserConversationSessionsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetUserConversationSessionsVariables): QueryRef<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
}
export const getUserConversationSessionsRef: GetUserConversationSessionsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getUserConversationSessions(dc: DataConnect, vars: GetUserConversationSessionsVariables): QueryPromise<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;

interface GetUserConversationSessionsRef {
  ...
  (dc: DataConnect, vars: GetUserConversationSessionsVariables): QueryRef<GetUserConversationSessionsData, GetUserConversationSessionsVariables>;
}
export const getUserConversationSessionsRef: GetUserConversationSessionsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getUserConversationSessionsRef:
```typescript
const name = getUserConversationSessionsRef.operationName;
console.log(name);
```

### Variables
The `GetUserConversationSessions` query requires an argument of type `GetUserConversationSessionsVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetUserConversationSessionsVariables {
  userId: UUIDString;
}
```
### Return Type
Recall that executing the `GetUserConversationSessions` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetUserConversationSessionsData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetUserConversationSessions`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getUserConversationSessions, GetUserConversationSessionsVariables } from '@dataconnect/generated';

// The `GetUserConversationSessions` query requires an argument of type `GetUserConversationSessionsVariables`:
const getUserConversationSessionsVars: GetUserConversationSessionsVariables = {
  userId: ..., 
};

// Call the `getUserConversationSessions()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getUserConversationSessions(getUserConversationSessionsVars);
// Variables can be defined inline as well.
const { data } = await getUserConversationSessions({ userId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getUserConversationSessions(dataConnect, getUserConversationSessionsVars);

console.log(data.conversationSessions);

// Or, you can use the `Promise` API.
getUserConversationSessions(getUserConversationSessionsVars).then((response) => {
  const data = response.data;
  console.log(data.conversationSessions);
});
```

### Using `GetUserConversationSessions`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getUserConversationSessionsRef, GetUserConversationSessionsVariables } from '@dataconnect/generated';

// The `GetUserConversationSessions` query requires an argument of type `GetUserConversationSessionsVariables`:
const getUserConversationSessionsVars: GetUserConversationSessionsVariables = {
  userId: ..., 
};

// Call the `getUserConversationSessionsRef()` function to get a reference to the query.
const ref = getUserConversationSessionsRef(getUserConversationSessionsVars);
// Variables can be defined inline as well.
const ref = getUserConversationSessionsRef({ userId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getUserConversationSessionsRef(dataConnect, getUserConversationSessionsVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.conversationSessions);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.conversationSessions);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateNewScenario
You can execute the `CreateNewScenario` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createNewScenario(vars: CreateNewScenarioVariables): MutationPromise<CreateNewScenarioData, CreateNewScenarioVariables>;

interface CreateNewScenarioRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewScenarioVariables): MutationRef<CreateNewScenarioData, CreateNewScenarioVariables>;
}
export const createNewScenarioRef: CreateNewScenarioRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createNewScenario(dc: DataConnect, vars: CreateNewScenarioVariables): MutationPromise<CreateNewScenarioData, CreateNewScenarioVariables>;

interface CreateNewScenarioRef {
  ...
  (dc: DataConnect, vars: CreateNewScenarioVariables): MutationRef<CreateNewScenarioData, CreateNewScenarioVariables>;
}
export const createNewScenarioRef: CreateNewScenarioRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createNewScenarioRef:
```typescript
const name = createNewScenarioRef.operationName;
console.log(name);
```

### Variables
The `CreateNewScenario` mutation requires an argument of type `CreateNewScenarioVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateNewScenarioVariables {
  description: string;
  difficultyLevel: number;
  title: string;
}
```
### Return Type
Recall that executing the `CreateNewScenario` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateNewScenarioData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateNewScenarioData {
  scenario_insert: Scenario_Key;
}
```
### Using `CreateNewScenario`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createNewScenario, CreateNewScenarioVariables } from '@dataconnect/generated';

// The `CreateNewScenario` mutation requires an argument of type `CreateNewScenarioVariables`:
const createNewScenarioVars: CreateNewScenarioVariables = {
  description: ..., 
  difficultyLevel: ..., 
  title: ..., 
};

// Call the `createNewScenario()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createNewScenario(createNewScenarioVars);
// Variables can be defined inline as well.
const { data } = await createNewScenario({ description: ..., difficultyLevel: ..., title: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createNewScenario(dataConnect, createNewScenarioVars);

console.log(data.scenario_insert);

// Or, you can use the `Promise` API.
createNewScenario(createNewScenarioVars).then((response) => {
  const data = response.data;
  console.log(data.scenario_insert);
});
```

### Using `CreateNewScenario`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createNewScenarioRef, CreateNewScenarioVariables } from '@dataconnect/generated';

// The `CreateNewScenario` mutation requires an argument of type `CreateNewScenarioVariables`:
const createNewScenarioVars: CreateNewScenarioVariables = {
  description: ..., 
  difficultyLevel: ..., 
  title: ..., 
};

// Call the `createNewScenarioRef()` function to get a reference to the mutation.
const ref = createNewScenarioRef(createNewScenarioVars);
// Variables can be defined inline as well.
const ref = createNewScenarioRef({ description: ..., difficultyLevel: ..., title: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createNewScenarioRef(dataConnect, createNewScenarioVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.scenario_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.scenario_insert);
});
```

## UpdateFeedbackSummary
You can execute the `UpdateFeedbackSummary` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
updateFeedbackSummary(vars: UpdateFeedbackSummaryVariables): MutationPromise<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;

interface UpdateFeedbackSummaryRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateFeedbackSummaryVariables): MutationRef<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;
}
export const updateFeedbackSummaryRef: UpdateFeedbackSummaryRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updateFeedbackSummary(dc: DataConnect, vars: UpdateFeedbackSummaryVariables): MutationPromise<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;

interface UpdateFeedbackSummaryRef {
  ...
  (dc: DataConnect, vars: UpdateFeedbackSummaryVariables): MutationRef<UpdateFeedbackSummaryData, UpdateFeedbackSummaryVariables>;
}
export const updateFeedbackSummaryRef: UpdateFeedbackSummaryRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updateFeedbackSummaryRef:
```typescript
const name = updateFeedbackSummaryRef.operationName;
console.log(name);
```

### Variables
The `UpdateFeedbackSummary` mutation requires an argument of type `UpdateFeedbackSummaryVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdateFeedbackSummaryVariables {
  conversationSessionId: UUIDString;
  feedbackSummary?: string | null;
}
```
### Return Type
Recall that executing the `UpdateFeedbackSummary` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdateFeedbackSummaryData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdateFeedbackSummaryData {
  conversationSession_update?: ConversationSession_Key | null;
}
```
### Using `UpdateFeedbackSummary`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updateFeedbackSummary, UpdateFeedbackSummaryVariables } from '@dataconnect/generated';

// The `UpdateFeedbackSummary` mutation requires an argument of type `UpdateFeedbackSummaryVariables`:
const updateFeedbackSummaryVars: UpdateFeedbackSummaryVariables = {
  conversationSessionId: ..., 
  feedbackSummary: ..., // optional
};

// Call the `updateFeedbackSummary()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updateFeedbackSummary(updateFeedbackSummaryVars);
// Variables can be defined inline as well.
const { data } = await updateFeedbackSummary({ conversationSessionId: ..., feedbackSummary: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updateFeedbackSummary(dataConnect, updateFeedbackSummaryVars);

console.log(data.conversationSession_update);

// Or, you can use the `Promise` API.
updateFeedbackSummary(updateFeedbackSummaryVars).then((response) => {
  const data = response.data;
  console.log(data.conversationSession_update);
});
```

### Using `UpdateFeedbackSummary`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updateFeedbackSummaryRef, UpdateFeedbackSummaryVariables } from '@dataconnect/generated';

// The `UpdateFeedbackSummary` mutation requires an argument of type `UpdateFeedbackSummaryVariables`:
const updateFeedbackSummaryVars: UpdateFeedbackSummaryVariables = {
  conversationSessionId: ..., 
  feedbackSummary: ..., // optional
};

// Call the `updateFeedbackSummaryRef()` function to get a reference to the mutation.
const ref = updateFeedbackSummaryRef(updateFeedbackSummaryVars);
// Variables can be defined inline as well.
const ref = updateFeedbackSummaryRef({ conversationSessionId: ..., feedbackSummary: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updateFeedbackSummaryRef(dataConnect, updateFeedbackSummaryVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.conversationSession_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.conversationSession_update);
});
```

