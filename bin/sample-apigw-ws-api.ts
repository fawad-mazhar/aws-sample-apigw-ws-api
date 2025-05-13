import * as cdk from 'aws-cdk-lib';
import { SampleApigwWsApiStack } from '../lib/sample-apigw-ws-stack'

const app = new cdk.App();
new SampleApigwWsApiStack(app, 'sample-apigw-ws-dev', {
  env: {
    account: '484667428814',
    region: 'eu-west-1',
  },
  stage: 'dev',
  prefix: 'sample-ws',
});