import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';
import * as cw from '@aws-cdk/aws-cloudwatch';
import * as path from 'path';

export class LocustCdkFargateStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Build the VPC
    const vpc = new ec2.Vpc(this, 'LocustFargateVPC', {
      maxAzs: 3, // Default is all AZs in region
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'LocustFargateCluster', {
      vpc: vpc,
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'LocustTaskDefinition', {
      memoryLimitMiB: 8192,
      cpu: 4096
    });

    // Build and define the Container
    const container = taskDefinition.addContainer('LocustContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'locust-container')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'LocustCdkFargate' }),
      environment: {'TARGET_URL': '127.0.0.1'}
    });
    // Add port to container definition
    container.addPortMappings({containerPort: 8089});

    // Setup service
    const loadBalancedFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Locust', {
      cluster,
      memoryLimitMiB: 8192,
      cpu: 4096,
      taskDefinition: taskDefinition
    });

  }
}
