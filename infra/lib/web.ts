import { existsSync } from "node:fs";
import { Annotations, Aws, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AllowedMethods, CachePolicy, Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AccountRecovery, UserPool } from "aws-cdk-lib/aws-cognito";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

// The caregiver web app: Cognito sign-in, a JWT-protected read API, and the built React app
// on a private S3 bucket behind CloudFront. The app reads /config.json at start-up, so the
// same build works for any deployment.

export interface CaregiverWebProps {
  apiFunction: IFunction;
  /** services/web/dist; when it's missing the site is created empty and a warning is shown. */
  distPath: string;
  removalPolicy: RemovalPolicy;
}

export class CaregiverWeb extends Construct {
  readonly url: string;

  constructor(scope: Construct, id: string, props: CaregiverWebProps) {
    super(scope, id);

    // Caregivers are invited by an admin (no self sign-up): a stranger mustn't be able to make an account.
    const users = new UserPool(this, "Users", {
      userPoolName: "aegiscare-caregivers",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: { minLength: 10, requireSymbols: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: props.removalPolicy,
    });
    const client = users.addClient("WebClient", {
      authFlows: { userPassword: true },
      generateSecret: false,
      idTokenValidity: Duration.hours(1),
      preventUserExistenceErrors: true,
    });

    const bucket = new Bucket(this, "Site", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const origin = S3BucketOrigin.withOriginAccessControl(bucket);
    const distribution = new Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: { origin, viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS },
      // Deploy-time settings must never be served stale.
      additionalBehaviors: { "/config.json": { origin, cachePolicy: CachePolicy.CACHING_DISABLED, allowedMethods: AllowedMethods.ALLOW_GET_HEAD } },
      // Single-page app: unknown paths load the app.
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) })),
    });
    this.url = `https://${distribution.distributionDomainName}`;

    const api = new HttpApi(this, "Api", {
      apiName: "aegiscare-caregiver",
      description: "Caregiver web app API",
      corsPreflight: {
        allowOrigins: [this.url, "http://localhost:3000"],
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
        maxAge: Duration.hours(1),
      },
    });
    // ID tokens carry the email claim the API uses to find the caregiver.
    const authorizer = new HttpJwtAuthorizer("Cognito", `https://cognito-idp.${Aws.REGION}.amazonaws.com/${users.userPoolId}`, {
      jwtAudience: [client.userPoolClientId],
    });
    const integration = new HttpLambdaIntegration("ApiIntegration", props.apiFunction);
    for (const [path, method] of [
      ["/me", HttpMethod.GET],
      ["/seniors/{seniorId}/overview", HttpMethod.GET],
      ["/incidents/{incidentId}/events", HttpMethod.GET],
      ["/alerts/{alertId}/ack", HttpMethod.POST],
    ] as const) {
      api.addRoutes({ path, methods: [method], integration, authorizer });
    }

    const config = { apiUrl: api.apiEndpoint, region: Aws.REGION, userPoolClientId: client.userPoolClientId };
    if (existsSync(props.distPath)) {
      new BucketDeployment(this, "Deploy", {
        destinationBucket: bucket,
        sources: [Source.asset(props.distPath), Source.jsonData("config.json", config)],
        distribution,
        distributionPaths: ["/*"],
      });
    } else {
      Annotations.of(this).addWarning(`${props.distPath} not found: run "npm run web:build" before deploying, or the site will be empty.`);
    }

    new CfnOutput(this, "WebUrl", { value: this.url, description: "Caregiver web app" });
    new CfnOutput(this, "UserPoolId", { value: users.userPoolId, description: "Invite caregivers here (aws cognito-idp admin-create-user)" });
    new CfnOutput(this, "WebApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "WebClientId", { value: client.userPoolClientId, description: "For services/web/.env.local when running locally" });
  }
}
