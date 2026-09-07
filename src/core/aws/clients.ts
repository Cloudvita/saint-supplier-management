import { TextractClient } from "@aws-sdk/client-textract";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { getEnv } from "@/core/config";

/**
 * No explicit credentials on purpose.
 * The AWS SDK default provider chain picks up:
 *   - local dev  -> ~/.aws/credentials or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *   - App Runner -> the instance role attached to the service
 * Never hard-code keys.
 *
 * Clients are lazy so that importing a module does not require AWS config.
 */
let _textract: TextractClient | null = null;
let _s3: S3Client | null = null;
let _ses: SESClient | null = null;

const region = () => getEnv().AWS_REGION;

export const getTextract = () => (_textract ??= new TextractClient({ region: region() }));
export const getS3 = () => (_s3 ??= new S3Client({ region: region() }));
export const getSes = () => (_ses ??= new SESClient({ region: region() }));
