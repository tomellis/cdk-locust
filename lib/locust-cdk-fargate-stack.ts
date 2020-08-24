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
    const primary_taskDefinition = new ecs.FargateTaskDefinition(this, 'LocustPrimaryTaskDefinition', {
      memoryLimitMiB: 8192,
      cpu: 4096
    });

    const primary_container = primary_taskDefinition.addContainer('LocustPrimaryContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'locust-container')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'LocustPrimaryCdkFargate' }),
      command: ["--master"],
    });
    // Add port to container definition
    primary_container.addPortMappings({containerPort: 8089});
    primary_container.addPortMappings({containerPort: 5557});
    primary_container.addPortMappings({containerPort: 5558});

    const worker_taskDefinition = new ecs.FargateTaskDefinition(this, 'LocustWorkerTaskDefinition', {
      memoryLimitMiB: 8192,
      cpu: 4096
    });

    const worker_container = worker_taskDefinition.addContainer('LocustPrimaryContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'locust-container')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'LocustWorkerCdkFargate' }),
      command: ["--worker", "--master-host", "primary.locust.local"],
    });
    // Add port to container definition
    worker_container.addPortMappings({containerPort: 8089});
    worker_container.addPortMappings({containerPort: 5557});
    worker_container.addPortMappings({containerPort: 5558});

    // Increase Number of Open file ulimits
    worker_container.addUlimits({
      name: ecs.UlimitName.NOFILE,
      softLimit: 65535,
      hardLimit: 65535,
    });

    // Setup Locust Primary service
    const privatePrimaryServiceName = 'primary'
    const primaryloadBalancedFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'LocustPrimary', {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster,
      memoryLimitMiB: 8192,
      cpu: 4096,
      desiredCount: 1,
      taskDefinition: primary_taskDefinition,
      openListener: true, // to disable public acccess, set to false and add private access below
      cloudMapOptions: {
        name: privatePrimaryServiceName
      },
    });

    // Allow the Locust Primary WebUI to be accessible only from our private IP addresses (precreated prefix list)
    //primaryloadBalancedFargateService.listener.connections.securityGroups[0].addIngressRule(
    //  ec2.Peer.prefixList('pl-00d10045486f5dcfc'),
    //  ec2.Port.tcp(80),
    //  "Allow access to ALB from my private IP addresses"
    //);

    // We have port 8089 exposed on the LB but also want our workers to access 5557/5558
    primaryloadBalancedFargateService.service.connections.securityGroups[0].addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcpRange(5557, 5558),
      "Allow Locust workers to primary connections"
    );

    // Locust Worker Service - no ALB requried
    const privateWorkerServiceName = 'worker'
    const workerFargateService = new ecs.FargateService(this, "LocustWorkers", {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster: cluster,
      taskDefinition: worker_taskDefinition,
      desiredCount: 10,
      assignPublicIp: false,
      cloudMapOptions: {
        name: privateWorkerServiceName
      },
    });

    workerFargateService.connections.securityGroups[0].addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcpRange(5557, 5558),
      "Allow Locust primary to workers connections"
    );

  }
}
