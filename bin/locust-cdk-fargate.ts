#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { LocustCdkFargateStack } from '../lib/locust-cdk-fargate-stack';

const app = new cdk.App();
new LocustCdkFargateStack(app, 'LocustCdkFargateStack');
