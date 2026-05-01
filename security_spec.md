# Security Specification - VeriFaith RAG

## Data Invariants
- A Knowledge segment must be attached to a valid `userId`.
- Users can only access (read/write/list) documents where `userId == request.auth.uid`.
- Knowledge type must be strictly "text" or "image".
- CreatedAt must be an immutable server timestamp.

## The Dirty Dozen (Threat Vectors)
1.  **Identity Spoofing**: Attempt to create a doc with someone else's `userId`.
2.  **Shadow Update**: Adding a `isVerified: true` field.
3.  **Cross-Tenant Leak**: Attempt to list all documents.
4.  **Resource Poisoning**: Sending a 2MB string into `title`.
5.  **Timestamp Fraud**: Manually setting `createdAt` to a past date.
6.  **Type Injection**: Setting `type` to "malware".
7.  **Null-Identity Write**: Writing as unauthenticated user.
8.  **Vector Corruption**: Replacing `embedding` list with junk data.
9.  **Relational Orphan**: Not applicable (no parent-child collections yet).
10. **Admin Escalation**: Setting a hypothetical `role: 'admin'` in a user profile.
11. **PII Scraping**: Attempting to get another user's document by ID.
12. **Denial of Wallet**: Creating 100,000 small documents in a loop.

## Test Runner (Logic)
- `firestore.rules` will be deployed and verified against these threats.
