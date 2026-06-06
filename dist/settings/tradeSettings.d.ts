import { z } from 'zod';
export declare const ComplianceCertSchema: z.ZodObject<{
    name: z.ZodString;
    number: z.ZodString;
    expiry: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    name: z.ZodString;
    number: z.ZodString;
    expiry: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    name: z.ZodString;
    number: z.ZodString;
    expiry: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export type ComplianceCert = z.infer<typeof ComplianceCertSchema>;
export declare const TradeSettingsSchema: z.ZodObject<{
    tradeName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    licenceNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    licenceExpiry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    warrantyPeriod: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    certPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    insurancePolicyNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    insuranceExpiry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    complianceCerts: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    branding: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>>;
    geofenceSettings: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bankName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bsb: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accountNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    tradeName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    licenceNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    licenceExpiry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    warrantyPeriod: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    certPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    insurancePolicyNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    insuranceExpiry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    complianceCerts: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    branding: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>>;
    geofenceSettings: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bankName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bsb: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accountNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    tradeName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    licenceNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    licenceExpiry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    warrantyPeriod: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    certPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    insurancePolicyNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    insuranceExpiry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    complianceCerts: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        name: z.ZodString;
        number: z.ZodString;
        expiry: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    branding: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        primaryColor: z.ZodDefault<z.ZodString>;
        accentColor: z.ZodDefault<z.ZodString>;
        template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>>;
    geofenceSettings: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        radiusMetres: z.ZodDefault<z.ZodNumber>;
        requireStartGeofence: z.ZodDefault<z.ZodBoolean>;
        requireEndGeofence: z.ZodDefault<z.ZodBoolean>;
        pingIntervalSeconds: z.ZodDefault<z.ZodNumber>;
        allowOverride: z.ZodDefault<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bankName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bsb: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accountNumber: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type TradeSettings = z.infer<typeof TradeSettingsSchema>;
//# sourceMappingURL=tradeSettings.d.ts.map