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

    // Setup a Service Discovery Namespace to the Fargate cluster
    const privateDomainName = 'locust.local'
    cluster.addDefaultCloudMapNamespace({
      name: privateDomainName
    })

    // Task Definition(s)
    const master_taskDefinition = new ecs.FargateTaskDefinition(this, 'LocustMasterTaskDefinition', {
      memoryLimitMiB: 8192,
      cpu: 4096
    });

    const master_container = master_taskDefinition.addContainer('LocustMasterContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'locust-container')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'LocustMasterCdkFargate' }),
      command: ["--master"],
    });
    // Add port to container definition
    master_container.addPortMappings({containerPort: 8089});
    master_container.addPortMappings({containerPort: 5557});
    master_container.addPortMappings({containerPort: 5558});

    const slave_taskDefinition = new ecs.FargateTaskDefinition(this, 'LocustSlaveTaskDefinition', {
      memoryLimitMiB: 8192,
      cpu: 4096
    });

    const slave_container = slave_taskDefinition.addContainer('LocustMasterContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'locust-container')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'LocustSlaveCdkFargate' }),
      command: ["--worker", "--master-host", "master.locust.local"],
    });
    // Add port to container definition
    slave_container.addPortMappings({containerPort: 8089});

    // Setup Locust Master service
    //// Exposes a web interfacve on port 8089
    //// Slaves join on 5557 & 5558
    const privateMasterServiceName = 'master'
    const masterloadBalancedFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'LocustMaster', {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster,
      memoryLimitMiB: 8192,
      cpu: 4096,
      desiredCount: 1,
      taskDefinition: master_taskDefinition,
      cloudMapOptions: {
        name: privateMasterServiceName
      },
    });

    // Setup Locust Slave service - no load balancer required
    const privateSlaveServiceName = 'slave'
    const slaveFargateService = new ecs.FargateService(this, "LocustSlaves", {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster: cluster,
      //memoryLimitMiB: 8192,
      //cpu: 4096,
      taskDefinition: slave_taskDefinition,
      desiredCount: 2,
      assignPublicIp: false,
      cloudMapOptions: {
        name: privateSlaveServiceName
      },
    });

  }
}
