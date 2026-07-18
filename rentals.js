(() => {
const availableFilter = document.getElementById('available-now-filter');
const categoryCards = Array.from(document.querySelectorAll('[data-category-availability]'));
const categoryEmpty = document.getElementById('category-empty');
const updateCategoryFilter = () => {
if (!availableFilter) return;
let visibleCount = 0;
categoryCards.forEach((card) => {
const shouldHide = availableFilter.checked && card.dataset.categoryAvailability !== 'available';
card.hidden = shouldHide;
if (!shouldHide) visibleCount += 1;
});
if (categoryEmpty) categoryEmpty.hidden = visibleCount > 0;
};
if (availableFilter) {
availableFilter.addEventListener('change', updateCategoryFilter);
updateCategoryFilter();
}
const form = document.getElementById('availability-form');
if (!form) return;
const subtotalEl = document.getElementById('quote-subtotal');
const messageEl = document.getElementById('availability-message');
const dateInput = document.getElementById('event-date');
const startInput = document.getElementById('event-start');
const endInput = document.getElementById('event-end');
const emptyState = document.getElementById('selected-rentals-empty');
const quickForm = document.getElementById('availability-check-form');
const quickDateInput = document.getElementById('quick-event-date');
const quickStartInput = document.getElementById('quick-event-start');
const quickEndInput = document.getElementById('quick-event-end');
const quickMessage = document.getElementById('date-check-message');
const mobileCta = document.getElementById('mobile-availability-cta');
const mobileCtaLabel = document.getElementById('mobile-availability-cta-label');
const inventory = {
roundTables: {
max: 3,
price: 16,
cardInput: document.getElementById('round-table-card-quantity'),
quoteInput: document.getElementById('round-table-quantity'),
row: document.querySelector('[data-quote-row="roundTables"]'),
addButton: document.querySelector('[data-add-item="roundTables"]'),
removeButton: document.querySelector('[data-remove-item="roundTables"]'),
addLabel: 'Add to Quote',
updateLabel: 'Update Quantity',
singular: '60-inch round table',
plural: '60-inch round tables'
},
rectangleTables: {
max: 2,
price: 14,
cardInput: document.getElementById('rectangle-table-card-quantity'),
quoteInput: document.getElementById('rectangle-table-quantity'),
row: document.querySelector('[data-quote-row="rectangleTables"]'),
addButton: document.querySelector('[data-add-item="rectangleTables"]'),
removeButton: document.querySelector('[data-remove-item="rectangleTables"]'),
addLabel: 'Add to Quote',
updateLabel: 'Update Quantity',
singular: '6-foot rectangular table',
plural: '6-foot rectangular tables'
},
canopy: {
max: 1,
price: null,
cardInput: document.getElementById('canopy-card-quantity'),
quoteInput: document.getElementById('canopy-quantity'),
row: document.querySelector('[data-quote-row="canopy"]'),
addButton: document.querySelector('[data-add-item="canopy"]'),
removeButton: document.querySelector('[data-remove-item="canopy"]'),
addLabel: 'Add to Quote',
updateLabel: 'Canopy Added',
singular: '10×10 pop-up canopy',
plural: '10×10 pop-up canopies'
}
};
const selectedItems = new Set();
const clampInput = (input, max) => {
const parsed = Number.parseInt(input.value || '1', 10);
const quantity = Math.min(max, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
input.value = String(quantity);
return quantity;
};
const updateStepButtons = (itemKey) => {
const item = inventory[itemKey];
const cardQuantity = clampInput(item.cardInput, item.max);
const quoteQuantity = clampInput(item.quoteInput, item.max);
const cardMinus = document.querySelector(`[data-card-step="-1"][data-item="${itemKey}"]`);
const cardPlus = document.querySelector(`[data-card-step="1"][data-item="${itemKey}"]`);
const quoteMinus = document.querySelector(`[data-quote-step="-1"][data-item="${itemKey}"]`);
const quotePlus = document.querySelector(`[data-quote-step="1"][data-item="${itemKey}"]`);
if (cardMinus) cardMinus.disabled = cardQuantity <= 1;
if (cardPlus) cardPlus.disabled = cardQuantity >= item.max;
if (quoteMinus) quoteMinus.disabled = quoteQuantity <= 1;
if (quotePlus) quotePlus.disabled = quoteQuantity >= item.max;
};
const selectedQuantity = (itemKey) => {
if (!selectedItems.has(itemKey)) return 0;
return clampInput(inventory[itemKey].quoteInput, inventory[itemKey].max);
};
const updateEmptyState = () => {
emptyState.hidden = selectedItems.size > 0;
};
const updateMobileCta = () => {
if (!mobileCta || !mobileCtaLabel) return;
if (selectedItems.size > 0) {
mobileCta.href = '#quote-builder';
mobileCtaLabel.textContent = `Review Quote (${selectedItems.size})`;
return;
}
if (dateInput.value || quickDateInput?.value) {
mobileCta.href = '#available-inventory';
mobileCtaLabel.textContent = 'Browse Rentals for Your Date';
return;
}
mobileCta.href = '#availability-check';
mobileCtaLabel.textContent = 'Check Date & Availability';
};
const formatRequestedItems = () => {
return Array.from(selectedItems).map((itemKey) => {
const item = inventory[itemKey];
const quantity = selectedQuantity(itemKey);
return `${quantity} ${quantity === 1 ? item.singular : item.plural}`;
});
};
const calculateSubtotal = () => {
let subtotal = 0;
let hasUnpricedItem = false;
selectedItems.forEach((itemKey) => {
const item = inventory[itemKey];
const quantity = selectedQuantity(itemKey);
if (item.price === null) {
hasUnpricedItem = true;
} else {
subtotal += quantity * item.price;
}
});
return { subtotal, hasUnpricedItem };
};
const updateSummary = () => {
const { subtotal, hasUnpricedItem } = calculateSubtotal();
const formattedSubtotal = subtotal.toLocaleString('en-US', {
style: 'currency',
currency: 'USD'
});
subtotalEl.textContent = hasUnpricedItem ? `${formattedSubtotal}*` : formattedSubtotal;
messageEl.className = '';
if (selectedItems.size === 0) {
messageEl.textContent = 'Add at least one rental item to begin your quote.';
updateMobileCta();
return;
}
if (!dateInput.value) {
messageEl.textContent = hasUnpricedItem
? 'Choose an event date. Canopy pricing will be confirmed separately.'
: 'Choose an event date to prepare your quote request.';
updateMobileCta();
return;
}
const requested = formatRequestedItems();
const pricingNote = hasUnpricedItem ? ' Canopy pricing will be confirmed separately.' : '';
messageEl.textContent = `Requested: ${requested.join(', ')}. Final availability will be confirmed by Regal Rentals.${pricingNote}`;
messageEl.classList.add('availability-message--ready');
updateMobileCta();
};
const addOrUpdateItem = (itemKey) => {
const item = inventory[itemKey];
if (!item) return;
const quantity = clampInput(item.cardInput, item.max);
selectedItems.add(itemKey);
item.quoteInput.value = String(quantity);
item.row.hidden = false;
item.row.classList.add('is-selected');
item.addButton.classList.add('is-added');
item.addButton.textContent = item.updateLabel;
updateEmptyState();
updateStepButtons(itemKey);
updateSummary();
};
const removeItem = (itemKey) => {
const item = inventory[itemKey];
if (!item || !selectedItems.has(itemKey)) return;
selectedItems.delete(itemKey);
item.row.hidden = true;
item.row.classList.remove('is-selected');
item.cardInput.value = '1';
item.quoteInput.value = '1';
item.addButton.classList.remove('is-added');
item.addButton.textContent = item.addLabel;
updateEmptyState();
updateStepButtons(itemKey);
updateSummary();
};
Object.entries(inventory).forEach(([itemKey, item]) => {
item.row.hidden = true;
item.row.classList.remove('is-selected');
item.addButton.textContent = item.addLabel;
item.addButton.addEventListener('click', () => addOrUpdateItem(itemKey));
item.removeButton.addEventListener('click', () => removeItem(itemKey));
item.cardInput.addEventListener('input', () => {
clampInput(item.cardInput, item.max);
updateStepButtons(itemKey);
});
item.cardInput.addEventListener('change', () => {
clampInput(item.cardInput, item.max);
updateStepButtons(itemKey);
});
item.quoteInput.addEventListener('input', () => {
const quantity = clampInput(item.quoteInput, item.max);
item.cardInput.value = String(quantity);
updateStepButtons(itemKey);
updateSummary();
});
item.quoteInput.addEventListener('change', () => {
const quantity = clampInput(item.quoteInput, item.max);
item.cardInput.value = String(quantity);
updateStepButtons(itemKey);
updateSummary();
});
updateStepButtons(itemKey);
});
document.querySelectorAll('[data-card-step][data-item]').forEach((button) => {
button.addEventListener('click', () => {
const itemKey = button.dataset.item;
const item = inventory[itemKey];
if (!item) return;
const current = clampInput(item.cardInput, item.max);
item.cardInput.value = String(current + Number(button.dataset.cardStep || 0));
clampInput(item.cardInput, item.max);
updateStepButtons(itemKey);
});
});
document.querySelectorAll('[data-quote-step][data-item]').forEach((button) => {
button.addEventListener('click', () => {
const itemKey = button.dataset.item;
const item = inventory[itemKey];
if (!item || !selectedItems.has(itemKey)) return;
const current = clampInput(item.quoteInput, item.max);
item.quoteInput.value = String(current + Number(button.dataset.quoteStep || 0));
const quantity = clampInput(item.quoteInput, item.max);
item.cardInput.value = String(quantity);
updateStepButtons(itemKey);
updateSummary();
});
});
const today = new Date();
today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
const minimumDate = today.toISOString().slice(0, 10);
dateInput.min = minimumDate;
if (quickDateInput) quickDateInput.min = minimumDate;
const syncQuickInputsToQuote = () => {
if (!quickDateInput || !quickStartInput || !quickEndInput) return;
dateInput.value = quickDateInput.value;
startInput.value = quickStartInput.value;
endInput.value = quickEndInput.value;
updateSummary();
};
const syncQuoteInputsToQuick = () => {
if (!quickDateInput || !quickStartInput || !quickEndInput) return;
quickDateInput.value = dateInput.value;
quickStartInput.value = startInput.value;
quickEndInput.value = endInput.value;
updateMobileCta();
};
if (quickForm && quickDateInput && quickStartInput && quickEndInput && quickMessage) {
quickForm.addEventListener('submit', (event) => {
event.preventDefault();
if (!quickForm.reportValidity()) return;
if (quickEndInput.value <= quickStartInput.value) {
quickMessage.textContent = 'For a same-day event, the end time must be later than the start time. Add overnight details in the quote notes.';
quickMessage.className = 'date-check-message date-check-message--error';
return;
}
syncQuickInputsToQuote();
const displayDate = new Date(`${quickDateInput.value}T12:00:00`).toLocaleDateString('en-US', {
weekday: 'long',
month: 'long',
day: 'numeric',
year: 'numeric'
});
quickMessage.textContent = `Showing current rental inventory for ${displayDate}, ${quickStartInput.value}–${quickEndInput.value}. Live booking-calendar results are not connected yet, so final availability will be confirmed before payment.`;
quickMessage.className = 'date-check-message date-check-message--ready';
document.getElementById('available-inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
updateMobileCta();
});
}
dateInput.addEventListener('input', () => {
syncQuoteInputsToQuick();
updateSummary();
});
dateInput.addEventListener('change', () => {
syncQuoteInputsToQuick();
updateSummary();
});
startInput.addEventListener('input', syncQuoteInputsToQuick);
endInput.addEventListener('input', syncQuoteInputsToQuick);
form.addEventListener('submit', (event) => {
event.preventDefault();
updateSummary();
if (selectedItems.size === 0) {
messageEl.textContent = 'Add at least one rental item before requesting a quote.';
messageEl.className = 'availability-message--error';
return;
}
if (!form.reportValidity()) return;
const data = new FormData(form);
const { subtotal, hasUnpricedItem } = calculateSubtotal();
const itemLines = Array.from(selectedItems).map((itemKey) => {
const item = inventory[itemKey];
const quantity = selectedQuantity(itemKey);
const name = quantity === 1 ? item.singular : item.plural;
return item.price === null
? `${name}: ${quantity} — pricing to be confirmed`
: `${name}: ${quantity} at $${item.price.toFixed(2)} each`;
});
const subtotalLine = hasUnpricedItem
? `Estimated known-price subtotal: $${subtotal.toFixed(2)} (canopy pricing not included)`
: `Estimated rental subtotal: $${subtotal.toFixed(2)}`;
const lines = [
'Regal Rentals Quote Request',
'',
`Name: ${data.get('name') || ''}`,
`Phone: ${data.get('phone') || ''}`,
`Email: ${data.get('email') || ''}`,
`Event date: ${data.get('eventDate') || ''}`,
`Event time: ${data.get('eventStart') || ''} to ${data.get('eventEnd') || ''}`,
`Service type: ${data.get('serviceType') || ''}`,
`Event city: ${data.get('eventCity') || ''}`,
'',
...itemLines,
subtotalLine,
'',
'Event notes:',
`${data.get('notes') || ''}`,
'',
'This request does not reserve inventory. Regal Rentals will confirm availability and final pricing.'
];
const subject = encodeURIComponent(`Regal Rentals quote request - ${data.get('eventDate') || 'event'}`);
const body = encodeURIComponent(lines.join('\n'));
window.location.href = `mailto:bookings@regal.rentals?subject=${subject}&body=${body}`;
});
updateEmptyState();
updateSummary();
updateMobileCta();
})();