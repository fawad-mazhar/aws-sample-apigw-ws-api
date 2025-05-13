import { APIGatewayProxyResult, Handler, SQSEvent } from 'aws-lambda'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { putItem, deleteItem, scanItems } from '../lib/ddb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

// Get environment variables
const connectionsTable = process.env.TABLE_NAME || ''
const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT || ''

// Calculate TTL for 1 year from now (in seconds)
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60

// Log environment variables for debugging
console.log('Environment variables:', {
  TABLE_NAME: connectionsTable,
  WEBSOCKET_ENDPOINT: websocketEndpoint
})

/**
 * Store a WebSocket connection in DynamoDB
 * @param connectionId The WebSocket connection ID
 */
async function storeConnection(connectionId: string): Promise<void> {
  console.log(`Storing connection ${connectionId}`)
  
  const timestamp = new Date().toISOString()
  
  const item = {
    TableName: connectionsTable,
    Item: marshall({
      connectionId: connectionId,
      connectedAt: timestamp,
      ttl: Math.floor(Date.now() / 1000) + ONE_YEAR_IN_SECONDS // 1 year TTL
    })
  }
  
  await putItem(item)
}

/**
 * Remove a WebSocket connection from DynamoDB
 * @param connectionId The WebSocket connection ID to remove
 */
async function removeConnection(connectionId: string): Promise<void> {
  console.log(`Removing connection ${connectionId}`)
   
  const params = {
    TableName: connectionsTable,
    Key: marshall({
      connectionId: connectionId
    })
  }
  
  await deleteItem(params)
}

/**
 * Removes a stale connection from DynamoDB
 * @param connectionId The WebSocket connection ID to remove
 */
async function removeStaleConnection(connectionId: string): Promise<void> {
  console.log(`Removing stale connection ${connectionId} from DynamoDB`)
  
  const params = {
    TableName: connectionsTable,
    Key: marshall({
      connectionId: connectionId
    })
  }
  
  try {
    await deleteItem(params)
    console.log(`Successfully removed stale connection ${connectionId}`)
  } catch (error) {
    console.error(`Error removing stale connection ${connectionId}:`, error)
  }
}

/**
 * Sends a message to a WebSocket client
 * @param endpoint The API Gateway endpoint URL (domainName/stage format)
 * @param connectionId The WebSocket connection ID
 * @param message The message to send
 */
async function sendMessageToClient(endpoint: string, connectionId: string, message: any): Promise<void> {
  console.log(`Sending message to connection ${connectionId}`)
  
  try {
    const client = new ApiGatewayManagementApiClient({
      endpoint: endpoint
    })
    
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(message))
    })
    
    await client.send(command)
    console.log(`Message sent to connection ${connectionId}`)
  } catch (error) {
    // Check if the error is a GoneException (connection is no longer valid)
    if ((error as any).name === 'GoneException') {
      console.log(`Connection ${connectionId} is gone, removing from database`)
      // Connection is no longer valid, delete it from the database
      await removeStaleConnection(connectionId)
    } else {
      console.error(`Error sending message to connection ${connectionId}:`, error)
      throw error
    }
  }
}

/**
 * Retrieves all active WebSocket connections from DynamoDB
 */
async function getConnections(): Promise<string[]> {
  console.log('Getting all connections from DynamoDB')
  
  const params = {
    TableName: connectionsTable
  }
  
  const result = await scanItems(params)
  
  if (!result.Items || result.Items.length === 0) {
    console.log('No connections found')
    return []
  }
  
  // Extract connection IDs from the scan result
  const connections = result.Items.map(item => {
    const unmarshalled = unmarshall(item)
    return unmarshalled.connectionId
  })
  
  console.log(`Found ${connections.length} connections`)
  return connections
}

/**
 * Determines if the event is an SQS event
 */
function isSQSEvent(event: any): event is SQSEvent {
  return event.Records && event.Records[0]?.eventSource === 'aws:sqs'
}

/**
 * Determines if the event is an API Gateway WebSocket event
 */
function isWebSocketEvent(event: any): boolean {
  return event.requestContext && event.requestContext.routeKey !== undefined
}

/**
 * Processes SQS messages and sends them to all connected WebSocket clients
 */
async function handleSQSEvent(event: SQSEvent): Promise<void> {
  console.log('Received SQS event:', JSON.stringify(event))
  
  try {
    // Process each SQS message
    for (const record of event.Records) {
      console.log('Processing SQS record:', record.messageId)
      
      // Get all active connections from DynamoDB
      let connectionData;
      try {
        connectionData = await getConnections()
        
        if (connectionData.length === 0) {
          console.log('No active connections to send message to')
          continue
        }
      } catch (error) {
        console.error('Error getting connections:', error)
        continue
      }
      
      // Parse the message body
      let messageBody;
      try {
        messageBody = JSON.parse(record.body)
        console.log('Message body:', messageBody)
      } catch (error) {
        console.log('Message is not JSON, using as plain text')
        messageBody = { text: record.body }
      }
      
      // Extract the data to send
      // If messageBody has a data field, use that, otherwise use the whole messageBody
      const postData = messageBody.data || messageBody
      
      // For each connection, send the message
      const postCalls = connectionData.map(async (connectionId) => {
        try {
          // Use the WebSocket endpoint from environment variables
          if (!websocketEndpoint) {
            console.error('WebSocket endpoint not provided in environment variables')
            return
          }
          
          // Convert wss:// to https:// for the API Gateway Management API
          let endpoint = websocketEndpoint
          if (endpoint.startsWith('wss://')) {
            endpoint = 'https://' + endpoint.substring(6)
          }
          
          await sendMessageToClient(endpoint, connectionId, postData)
        } catch (error) {
          console.error(`Failed to send to connection ${connectionId}:`, error)
        }
      })
      
      // Wait for all messages to be sent
      await Promise.all(postCalls)
      
      console.log(`Message sent to ${connectionData.length} connections`)
    }
  } catch (error) {
    console.error('Error processing SQS messages:', error)
    throw error
  }
}

/**
 * Handle the ping route - respond with pong
 */
async function handlePingRoute(connectionId: string, domainName: string, stage: string): Promise<APIGatewayProxyResult> {
  console.log(`Handling ping from connection ${connectionId}`)
  
  try {
    // Construct the endpoint URL
    const endpoint = `https://${domainName}/${stage}`
    
    // Send pong response back to the client
    await sendMessageToClient(endpoint, connectionId, { action: 'pong' })
    
    return { statusCode: 200, body: 'Pong sent' }
  } catch (error) {
    console.error('Error handling ping:', error)
    return { statusCode: 500, body: 'Error handling ping' }
  }
}

/**
 * Handles WebSocket connection events
 */
async function handleWebSocketEvent(event: any): Promise<APIGatewayProxyResult> {
  console.log('[WEBSOCKET EVENT]', JSON.stringify(event))
  
  const connectionId = event.requestContext.connectionId
  const routeKey = event.requestContext.routeKey
  const domainName = event.requestContext.domainName
  const stage = event.requestContext.stage
  
  try {
    // Handle WebSocket lifecycle events
    if (routeKey === '$connect') {
      // Store connection ID
      await storeConnection(connectionId)
      return { statusCode: 200, body: 'Connected' }
    }
    
    if (routeKey === '$disconnect') {
      // Remove connection ID
      await removeConnection(connectionId)
      return { statusCode: 200, body: 'Disconnected' }
    }
    
    // Handle ping route
    if (routeKey === 'ping') {
      return await handlePingRoute(connectionId, domainName, stage)
    }
    
    // Handle custom action routes from message body
    if (routeKey === '$default') {
      try {
        const body = JSON.parse(event.body || '{}')
        
        // Check if this is a ping action
        if (body.action === 'ping') {
          return await handlePingRoute(connectionId, domainName, stage)
        }
        
        // Handle other actions here
        
        return { statusCode: 200, body: 'Message received' }
      } catch (error) {
        console.error('Error parsing message body:', error)
        return { statusCode: 400, body: 'Invalid message format' }
      }
    }
    
    // Unhandled route
    return { statusCode: 400, body: `Unhandled route: ${routeKey}` }
  } catch (error) {
    console.error('Error processing WebSocket message:', error)
    return { statusCode: 500, body: 'Internal server error' }
  }
}

/**
 * Combined handler for both WebSocket events and SQS events
 */
export const handler: Handler = async (event: any): Promise<any> => {
  // Check if this is an SQS event
  if (isSQSEvent(event)) {
    await handleSQSEvent(event)
    return { statusCode: 200, body: 'SQS messages processed' }
  }
  
  // Check if this is a WebSocket event
  if (isWebSocketEvent(event)) {
    return handleWebSocketEvent(event)
  }
  
  // Unknown event type
  console.error('Unknown event type:', event)
  return { statusCode: 400, body: 'Unknown event type' }
}
