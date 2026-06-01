# Passkey Modal Component

A modern, accessible passkey sign-in modal UI component for the Vivago Pass browser extension.

## Features

✅ **Beautiful Dark UI** - Matches your extension's design system  
✅ **Fully Accessible** - Keyboard navigation, ARIA labels, semantic HTML  
✅ **Responsive** - Works on desktop and mobile  
✅ **Easy Integration** - Simple TypeScript API  
✅ **Multiple States** - Loading, empty, error, and success states  
✅ **Smooth Animations** - Polished transitions and hover effects  

## Files

- **`passkey-modal.html`** - HTML markup (include in your popup.html)
- **`passkey-modal.css`** - Styling (import in your popup.css)
- **`passkey-modal.ts`** - TypeScript class and logic
- **`passkey-modal.example.ts`** - Usage examples

## Installation

### 1. Add HTML and CSS to your popup

In your `popup.html`, add the modal HTML (usually at the end of body):

```html
<!-- Include the passkey modal -->
<div id="passkey-modal" class="passkey-modal hidden">
  <!-- Modal content will be dynamically inserted -->
  <!-- OR copy from passkey-modal.html -->
</div>
```

In your `popup.css`, import the modal styles:

```css
@import "./passkey-modal.css";
```

### 2. Import and initialize in TypeScript

```typescript
import { initializePasskeyModal } from "./passkey-modal";

const modal = initializePasskeyModal();
```

## Usage

### Basic Example

```typescript
import { initializePasskeyModal } from "./passkey-modal";

const modal = initializePasskeyModal();

// Define passkey options
const passkeys = [
  {
    id: "pk-1",
    label: "localhost",
    email: "user@example.com",
    icon: "👤"
  },
  {
    id: "pk-2",
    label: "localhost",
    email: "user@example.com",
    icon: "👤"
  }
];

// Setup callbacks
modal.onSelect((passkey) => {
  console.log("User selected:", passkey);
  // Send to background script for authentication
  chrome.runtime.sendMessage({
    type: "authenticate-with-passkey",
    passkeyId: passkey.id
  });
});

modal.onClose(() => {
  console.log("Modal closed");
});

// Show the modal
modal.show(passkeys);
```

### Showing Loading State

```typescript
modal.showLoading();
// Fetch passkeys...
// Then call modal.show(passkeys)
```

### Showing Error State

```typescript
modal.showError("Failed to load passkeys. Please try again.");
```

### Closing the Modal

```typescript
modal.close();
```

### Checking if Open

```typescript
if (modal.isOpen()) {
  console.log("Modal is open");
}
```

## API Reference

### `PasskeyModal` Class

#### Methods

- **`show(passkeys: PasskeyOption[])`** - Display modal with passkey options
- **`close()`** - Close the modal
- **`isOpen(): boolean`** - Check if modal is currently open
- **`showLoading()`** - Show loading state
- **`showError(message: string)`** - Show error message
- **`onSelect(callback)`** - Set callback when passkey is selected
- **`onClose(callback)`** - Set callback when modal is closed

### `PasskeyOption` Interface

```typescript
interface PasskeyOption {
  id: string;        // Unique identifier
  label: string;     // Display label (e.g., "localhost")
  email: string;     // Email associated with passkey
  icon?: string;     // Optional emoji or icon (default: "👤")
}
```

## Styling Customization

The modal uses CSS variables for theming. Modify `passkey-modal.css` to customize:

- Colors (background gradients, text colors)
- Border radius and shadows
- Font sizes and weights
- Spacing and padding
- Animation durations

## Accessibility Features

- ✅ Keyboard navigation (Tab, Enter, Space, Esc)
- ✅ ARIA labels and roles
- ✅ Focus management
- ✅ Semantic HTML structure
- ✅ High contrast colors (WCAG AA compliant)
- ✅ Screen reader friendly

## Browser Compatibility

- Chrome/Chromium (88+)
- Edge (88+)
- Firefox (90+)
- Safari (15+)

## Integration with Extension

### 1. Modify your `popup.ts` to include the modal

```typescript
// At the top
import { initializePasskeyModal } from "./passkey-modal";

// In your login handler
document.addEventListener("DOMContentLoaded", () => {
  const modal = initializePasskeyModal();
  // ... rest of your code
});
```

### 2. In your `background.ts` or auth handler

```typescript
// Listen for passkey authentication requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "authenticate-with-passkey") {
    // Implement your passkey authentication logic
    authenticateWithPasskey(request.passkeyId)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
  }
});
```

## Best Practices

1. **Show loading state first** - Always display loading when fetching passkeys
2. **Handle errors gracefully** - Show helpful error messages
3. **Keyboard support** - Test with Tab, Enter, and Escape keys
4. **Prevent body scroll** - Modal automatically disables body scroll when open
5. **Escape key** - Users can press Esc to close the modal
6. **Backdrop click** - Users can click outside to close (optional behavior)

## Performance Tips

- Modal CSS is optimized (no heavy animations)
- Minimal JavaScript overhead
- Lazy load passkeys only when modal opens
- Reuse modal instance (don't create multiple instances)

## Troubleshooting

### Modal doesn't appear
- Ensure HTML markup is in your popup.html
- Check CSS file is properly imported
- Verify modal element has id="passkey-modal"

### Callbacks not firing
- Make sure to call `.onSelect()` before `.show()`
- Check browser console for errors

### Styling looks wrong
- Ensure CSS file is imported in correct order
- Check for CSS conflicts with other stylesheets
- Clear browser cache

## License

Part of Vivago Pass extension. All rights reserved.
