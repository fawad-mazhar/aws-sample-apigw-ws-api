# AWS API Gateway WebSocket API Sample

This project demonstrates a serverless WebSocket API implementation using AWS CDK, API Gateway, Lambda, DynamoDB, and SQS.

## Architecture

### Components

- **API Gateway WebSocket API**: Handles WebSocket connections and routes
- **Lambda Functions**:
  - **Main Handler**: Processes WebSocket events and SQS messages
  - **Authorizer**: Validates connection requests
  - **Update Route**: Custom resource for configuring the API
- **DynamoDB**: Stores active WebSocket connections
- **SQS Queue**: Receives messages to be broadcast to all connected clients

### How It Works

1. **Connection Flow**:
   - Client connects to the WebSocket API with a token
   - Authorizer Lambda validates the token
   - If authorized, the connection ID is stored in DynamoDB

2. **Message Broadcasting**:
   - Messages sent to the SQS queue
   - Lambda processes the SQS event
   - Lambda retrieves all active connections from DynamoDB
   - Messages are sent to all connected clients

3. **Ping/Pong**:
   - Client sends a message to the 'ping' route
   - Lambda responds with a 'pong' message

4. **Disconnection**:
   - When a client disconnects, the connection ID is removed from DynamoDB
   - Stale connections are automatically cleaned up when messages fail to deliver

## Features

- WebSocket connection management (connect/disconnect)
- Ping/Pong route for testing connection status
- Message broadcasting to all connected clients via SQS
- Connection cleanup for stale connections
- Lambda authorizer for securing WebSocket connections
- Custom resource for attaching the authorizer to the $connect route

## Routes

- `$connect`: Handles new WebSocket connections
- `$disconnect`: Handles WebSocket disconnections
- `ping`: Responds with a pong message
- `$default`: Handles all other messages (supports action-based routing)

## Usage

### Connecting to the WebSocket API

Use a WebSocket client like `websocat` to connect to your deployed API. Since the API now has an authorizer, you need to include a token in the query string:

```bash
websocat -v "wss://your-api-id.execute-api.region.amazonaws.com/dev?token=allow-ws-connection"
```

> Note: The authorizer is configured to accept the token `allow-ws-connection`. In a production environment, you would implement proper authentication logic in the authorizer Lambda.

### Authorization Flow

The WebSocket API uses a Lambda authorizer to secure connections:

1. When a client attempts to connect, API Gateway invokes the authorizer Lambda
2. The authorizer validates the token from the query string parameters
3. If valid, the authorizer returns an IAM policy that allows the connection
4. If invalid, the authorizer returns a policy that denies the connection
5. The connection is established or rejected based on the policy

### Custom Resource Implementation

The project uses a custom resource to attach the authorizer to the WebSocket API's $connect route:

1. A Lambda function (`update-route.ts`) is created to update the $connect route
2. A custom resource provider triggers this Lambda during deployment
3. The Lambda function finds the existing $connect route and updates it to use the authorizer
4. This approach allows for fully automated deployment without manual steps

### Testing the Ping Route

Send a ping message to test the connection:

```json
{"action":"ping"}
```

You should receive a pong response:

```json
{"action":"pong"}
```

### Sending Messages via SQS

Send a message to the SQS queue to broadcast it to all connected clients:

```bash
aws sqs send-message --queue-url YOUR_QUEUE_URL --message-body '{"data":{"message":"Hello from SQS!"}}'  
```

## Deployment
<details>
  <summary>Pre-requisites</summary>

  - 🔧 AWS CLI Installed & Configured 👉 [Get help here](https://aws.amazon.com/cli/)
  - 🔧 Node.js 18.x+
  - 🔧 AWS CDK 👉 [Get help here](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) 
</details>

<details>
  <summary>Installation</summary>
  Run command:

  ```bash
  npm install
  npm run bootstrap:dev
  ```
</details>
  
<details>
  <summary>Deploying (eu-west-1)</summary>
  Run command:

  ```bash
  npm run deploy:dev
  ```
</details>


## License

This project is licensed under the MIT License. See the LICENSE file for more details.