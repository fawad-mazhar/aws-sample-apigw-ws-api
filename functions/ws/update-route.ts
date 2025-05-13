import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse } from 'aws-lambda';
import * as AWS from 'aws-sdk';

/**
 * Lambda function that updates the $connect route to use the authorizer
 */
export const handler = async (event: CloudFormationCustomResourceEvent): Promise<CloudFormationCustomResourceResponse> => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Only process CREATE and UPDATE events
  if (event.RequestType !== 'Create' && event.RequestType !== 'Update') {
    return sendResponse(event, 'SUCCESS', {});
  }
  
  // Get API ID and Authorizer ID from the custom resource properties
  const apiId = event.ResourceProperties.ApiId;
  const authorizerId = event.ResourceProperties.AuthorizerId;
  
  try {
    const apigatewayv2 = new AWS.ApiGatewayV2();
    
    // Get all routes for the API
    const routes = await apigatewayv2.getRoutes({ ApiId: apiId }).promise();
    
    // Find the $connect route
    const connectRoutes = routes.Items || [];
    const connectRoute = connectRoutes.find(route => route.RouteKey === '$connect');
    
    if (!connectRoute) {
      throw new Error('$connect route not found');
    }
    
    console.log('Found $connect route:', connectRoute);
    
    // Make sure we have valid IDs before proceeding
    if (!connectRoute.RouteId || !apiId || !authorizerId) {
      throw new Error('Missing required IDs for route update');
    }
    
    // Update the route to use the authorizer
    await apigatewayv2.updateRoute({
      ApiId: apiId,
      RouteId: connectRoute.RouteId,
      AuthorizationType: 'CUSTOM',
      AuthorizerId: authorizerId
    }).promise();
    
    console.log('Updated $connect route with authorizer');
    
    return sendResponse(event, 'SUCCESS', {
      RouteId: connectRoute.RouteId
    });
  } catch (error) {
    console.error('Error updating route:', error);
    return sendResponse(event, 'FAILED', {}, (error as Error).message);
  }
};

/**
 * Helper function to send CloudFormation response
 */
function sendResponse(
  event: CloudFormationCustomResourceEvent,
  status: 'SUCCESS' | 'FAILED',
  data: Record<string, any>,
  reason?: string
): CloudFormationCustomResourceResponse {
  const responseBody: CloudFormationCustomResourceResponse = {
    Status: status,
    Reason: reason || 'See the details in CloudWatch Log',
    PhysicalResourceId: event.LogicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  };
  
  console.log('Response body:', responseBody)
  return responseBody
}
