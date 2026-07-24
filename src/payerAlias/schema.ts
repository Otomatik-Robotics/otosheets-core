/** A learned payer → client link. `payerKey` is the normaliseMerchant() output. */
export interface PayerAlias {
    orgId: string;
    payerKey: string;
    clientId: string;
    createdBy: string | null;
}
