import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';

/**
 * Lambda authorizer for WebSocket API
 * 
 * This function validates the authorization token in the request and returns
 * an IAM policy document that allows or denies the connection.
 * 
 * For WebSocket APIs, the authorizer is invoked during the $connect route.
 */
export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  console.log('Auth event:', JSON.stringify(event, null, 2));
  
  // Get the authorization token from the request
  // For WebSocket, the token is typically in the query string parameters
  const queryStringParameters = event.queryStringParameters || {};
  const token = queryStringParameters.token;
  
  // Get the methodArn from the event
  const methodArn = event.methodArn;
  
  // Validate the token
  if (token === 'allow-ws-connection') {
    return generatePolicy('user', 'Allow', methodArn, {
      // You can include additional context that will be available in the $connect event
      userId: '123456',
      userRole: 'standard'
    });
  }
  
  return generatePolicy('user', 'Deny', methodArn);
};

/**
 * Helper function to generate an IAM policy
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, any>
): APIGatewayAuthorizerResult {
  const authResponse: APIGatewayAuthorizerResult = {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource
        }
      ]
    }
  };
  
  // Add context if provided
  if (context) {
    authResponse.context = context;
  }
  
  return authResponse;
}
