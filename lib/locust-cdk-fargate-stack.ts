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
    slave_container.addPortMappings({containerPort: 5557});
    slave_container.addPortMappings({containerPort: 5558});

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
      openListener: false, // disable public acccess and add private access below, set to true if you want to be able to access
      cloudMapOptions: {
        name: privateMasterServiceName
      },
    });

    // Allow the Locust Master WebUI to be accessible only from our private IP addresses (precreated prefix list)
    masterloadBalancedFargateService.listener.connections.securityGroups[0].addIngressRule(
      ec2.Peer.prefixList('pl-00d10045486f5dcfc'),
      ec2.Port.tcp(80),
      "Allow access to ALB from my private IP addresses"
    );

    // We have port 8089 exposed on the LB but also want our slaves to access 5557/5558
    masterloadBalancedFargateService.service.connections.securityGroups[0].addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcpRange(5557, 5558),
      "Allow Locust slaves to master connections"
    );

    // Locust Slave Service - no ALB requried
    const privateSlaveServiceName = 'slave'
    const slaveFargateService = new ecs.FargateService(this, "LocustSlaves", {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster: cluster,
      taskDefinition: slave_taskDefinition,
      desiredCount: 10,
      assignPublicIp: false,
      cloudMapOptions: {
        name: privateSlaveServiceName
      },
    });

    slaveFargateService.connections.securityGroups[0].addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcpRange(5557, 5558),
      "Allow Locust master to slaves connections"
    );

  }
}
