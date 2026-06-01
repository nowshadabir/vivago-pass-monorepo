Rules for the AI Assistant
Never leak secrets in code: Ensure memory containing plaintext passwords or Encryption Keys is zeroed out or aggressively garbage-collected.

Strict Typing: Always use TypeScript interfaces for database models and API payloads.

Validate Everything: The Node.js backend must assume the client is compromised. Validate all incoming payload sizes, structure, and authentication tokens before writing to MySQL.

No UI Assumptions: Provide raw functional components, custom hooks, or API route logic. Leave the rendering and styling to the user.

Cross-Platform Mindset: When writing cryptographic helper functions, remember that a Dart equivalent must eventually be written. Keep the logic modular and portable.
