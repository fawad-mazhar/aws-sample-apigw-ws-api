import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration, CustomResource } from 'aws-cdk-lib'
import { Provider } from 'aws-cdk-lib/custom-resources'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { WebSocketApi, WebSocketStage } from '@aws-cdk/aws-apigatewayv2-alpha'
import { CfnAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2'
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources"
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'
import * as path from 'path'


interface ApigwWsApiStackProps extends StackProps {
  stage: string
  prefix: string
}

export class SampleApigwWsApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApigwWsApiStackProps) {
    super(scope, id, props);

    // Create a Dead Letter Queue (DLQ) to handle failed message processing
    // The DLQ name is constructed using the prefix, 'dlq' and stage name
    const dlq = new Queue(this, `${props.prefix}-dlq-${props.stage}`, {
      queueName: `${props.prefix}-dlq-${props.stage}`
    })
    
    // Create the main SQS queue for publishing messages
    // - Uses the prefix, 'publish-q' and stage name for the queue name
    // - Configures the DLQ as the dead letter queue
    // - Messages will be sent to DLQ after 1 failed processing attempt (maxReceiveCount: 1)
    const q = new Queue(this, `${props.prefix}-publish-q-${props.stage}`, {
      queueName: `${props.prefix}-publish-q-${props.stage}`,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 1
      }
    })
    new CfnOutput(this, `${props.prefix}-publish-q-output-${props.stage}`, {
      description: "Queue URL for publishing messages to websocket connected clients.",
      value: `${q.queueUrl}`,
    })
    

    // Creates a new DynamoDB table for storing WebSocket connection information
    const table = new Table(this, `${props.prefix}-connections-${props.stage}`, {
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: { name: "connectionId", type: AttributeType.STRING },
      tableName: `${props.prefix}-connections-${props.stage}`,
      timeToLiveAttribute: 'ttl'
    })
    
    // Lambda function that handles both WebSocket connections and SQS messages
    new LogGroup(this, `${props.prefix}-handler-log-grp-${props.stage}`, {
      logGroupName: `/aws/lambda/${props.prefix}-handler-${props.stage}`,
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const wsHandler = new NodejsFunction(this, `${props.prefix}-handler-${props.stage}`, {
      functionName: `${props.prefix}-handler-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      handler: 'handler',
      environment: {
        TABLE_NAME: table.tableName,
        QUEUE_URL: q.queueUrl,
      },
      entry: path.join(__dirname, '/../functions/ws/handler.ts'),
    })
    table.grantReadWriteData(wsHandler)
    
    // Create Lambda authorizer function
    new LogGroup(this, `${props.prefix}-authorizer-log-grp-${props.stage}`, {
      logGroupName: `/aws/lambda/${props.prefix}-authorizer-${props.stage}`,
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const wsAuthorizer = new NodejsFunction(this, `${props.prefix}-authorizer-${props.stage}`, {
      functionName: `${props.prefix}-authorizer-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      handler: 'handler',
      entry: path.join(__dirname, '/../functions/ws/authorizer.ts'),
    })


    // Create the WebSocket API first (without authorizer)
    const wsApi = new WebSocketApi(this, `${props.prefix}-api-${props.stage}`, {
      apiName: `${props.prefix}-api-${props.stage}`,
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("wsHandlerIntegration", wsHandler),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("wsHandlerIntegration", wsHandler),
      },
      routeSelectionExpression: "$request.body.action",
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration("wsDefaultIntegration", wsHandler),
      },
    }) 
    
    // Add ping route
    wsApi.addRoute('ping', {
      integration: new WebSocketLambdaIntegration("wsPingIntegration", wsHandler),
    })
    new WebSocketStage(this, `${props.prefix}-stage-${props.stage}`, {
      webSocketApi: wsApi,
      stageName: props.stage,
      autoDeploy: true,
    })
    new CfnOutput(this, `${props.prefix}-api-output-${props.stage}`, {
      description: "WebSocket API endpoint.",
      value: `${wsApi.apiEndpoint}/${props.stage}`,
    })
    
    // Create a Lambda authorizer for the WebSocket API
    const authorizer = new CfnAuthorizer(this, `${props.prefix}-cfn-authorizer-${props.stage}`, {
      apiId: wsApi.apiId,
      authorizerType: 'REQUEST',
      name: `${props.prefix}-authorizer-${props.stage}`,
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsAuthorizer.functionArn}/invocations`,
      identitySource: ['route.request.querystring.token']
    })
    
    // Grant the API Gateway permission to invoke the authorizer Lambda
    wsAuthorizer.addPermission('InvokeByApiGateway', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/*`
    })
    
    // Create a custom resource to update the existing $connect route
    new LogGroup(this, `${props.prefix}-update-route-log-grp-${props.stage}`, {
      logGroupName: `/aws/lambda/${props.prefix}-update-route-${props.stage}`,
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    
    // Create the Lambda function that will update the route
    const updateRouteFunction = new NodejsFunction(this, `${props.prefix}-update-route-${props.stage}`, {
      functionName: `${props.prefix}-update-route-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      handler: 'handler',
      entry: path.join(__dirname, '/../functions/ws/update-route.ts'),
    });
    
    updateRouteFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'apigateway:GET',
        'apigateway:PUT',
        'apigateway:PATCH'
      ],
      resources: [`arn:aws:apigateway:${this.region}::/apis/${wsApi.apiId}/*`]
    }));
    
    // Create a provider to avoid circular dependencies
    const provider = new Provider(this, `${props.prefix}-route-provider-${props.stage}`, {
      onEventHandler: updateRouteFunction,
    });
    

    const updateRouteCustomResource = new CustomResource(this, `${props.prefix}-update-route-cr-${props.stage}`, {
      serviceToken: provider.serviceToken,
      properties: {
        UpdateTimestamp: Date.now().toString(),
        ApiId: wsApi.apiId,
        AuthorizerId: authorizer.ref
      }
    });
    
    // Add dependencies to ensure proper creation order
    updateRouteCustomResource.node.addDependency(authorizer);
    updateRouteCustomResource.node.addDependency(wsApi);
    
    // Output the authorizer ID for reference
    new CfnOutput(this, `${props.prefix}-authorizer-id-${props.stage}`, {
      description: "WebSocket API Authorizer ID",
      value: authorizer.ref
    })
    
    // Update the wsHandler to use the correct WebSocket endpoint
    wsHandler.addEnvironment('WEBSOCKET_ENDPOINT', `${wsApi.apiEndpoint}/${props.stage}`)
    
    // Add SQS event source to the wsHandler
    wsHandler.addEventSource(new SqsEventSource(q, {
      batchSize: 10
    }))
    
    // Grant permission to the wsHandler to manage WebSocket connections
    wsHandler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/*`]
    }))

  }
}
