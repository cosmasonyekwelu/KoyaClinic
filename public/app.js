/**
 * Koya Clinic Appointment Booking Frontend Application
 * Interacts with /api server-side proxy connected to the deployed booking API.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const apiStatus = document.getElementById('api-status');
  const providerSelect = document.getElementById('provider-select');
  const refreshSlotsBtn = document.getElementById('refresh-slots-btn');
  const slotsLoading = document.getElementById('slots-loading');
  const slotsError = document.getElementById('slots-error');
  const slotsEmpty = document.getElementById('slots-empty');
  const slotsContainer = document.getElementById('slots-container');

  // Booking Form Elements
  const bookingForm = document.getElementById('booking-form');
  const bookingSlotIdInput = document.getElementById('booking-slot-id');
  const patientNameInput = document.getElementById('patient-name');
  const patientEmailInput = document.getElementById('patient-email');
  const submitBookingBtn = document.getElementById('submit-booking-btn');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');
  const cancelSelectionBtn = document.getElementById('cancel-selection-btn');
  const selectedSlotBanner = document.getElementById('selected-slot-details');
  const bannerProvider = document.getElementById('banner-provider');
  const bannerDatetime = document.getElementById('banner-datetime');
  const bannerSlotId = document.getElementById('banner-slot-id');
  const bookingErrorAlert = document.getElementById('booking-error-alert');
  const nameError = document.getElementById('name-error');
  const emailError = document.getElementById('email-error');

  // Confirmation Panel Elements
  const confirmationSection = document.getElementById('confirmation-section');
  const confBookingId = document.getElementById('conf-booking-id');
  const confPatientName = document.getElementById('conf-patient-name');
  const confEmail = document.getElementById('conf-email');
  const confProvider = document.getElementById('conf-provider');
  const confDate = document.getElementById('conf-date');
  const confTime = document.getElementById('conf-time');
  const confStatus = document.getElementById('conf-status');
  const bookAnotherBtn = document.getElementById('book-another-btn');
  const lookupThisBookingBtn = document.getElementById('lookup-this-booking-btn');

  // Lookup Elements
  const lookupForm = document.getElementById('lookup-form');
  const lookupBookingIdInput = document.getElementById('lookup-booking-id');
  const lookupSubmitBtn = document.getElementById('lookup-submit-btn');
  const lookupBtnText = document.getElementById('lookup-btn-text');
  const lookupBtnSpinner = document.getElementById('lookup-btn-spinner');
  const lookupErrorAlert = document.getElementById('lookup-error-alert');
  const lookupResultPanel = document.getElementById('lookup-result-panel');
  const lookBookingId = document.getElementById('look-booking-id');
  const lookPatientName = document.getElementById('look-patient-name');
  const lookEmail = document.getElementById('look-email');
  const lookProvider = document.getElementById('look-provider');
  const lookDate = document.getElementById('look-date');
  const lookTime = document.getElementById('look-time');
  const lookStatus = document.getElementById('look-status');

  // State
  let allSlots = [];
  let selectedSlot = null;
  let isSubmitting = false;
  let lastConfirmedBooking = null;

  /**
   * Format ISO date string into readable Date and Time
   */
  function formatDateTime(isoString) {
    if (!isoString) return { date: '-', time: '-' };
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { date: isoString, time: isoString };

    const date = d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    });

    return { date, time };
  }

  /**
   * Health Check
   */
  async function checkHealth() {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          apiStatus.textContent = 'Service: Online';
          apiStatus.className = 'status-badge online';
          return;
        }
      }
      throw new Error('Unhealthy');
    } catch {
      apiStatus.textContent = 'Service: Offline';
      apiStatus.className = 'status-badge offline';
    }
  }

  /**
   * Fetch slots from proxy GET /api/slots
   */
  async function fetchSlots(silent = false) {
    if (!silent) {
      slotsLoading.style.display = 'block';
      slotsError.style.display = 'none';
      slotsEmpty.style.display = 'none';
    }

    try {
      const selectedProvider = providerSelect.value;
      const query = selectedProvider ? `?provider=${encodeURIComponent(selectedProvider)}` : '';
      const res = await fetch(`/api/slots${query}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load slots');
      }

      const rawSlots = Array.isArray(data.slots) ? data.slots : [];
      allSlots = rawSlots;

      // Update provider filter options without resetting current selection
      updateProviderOptions(rawSlots);

      // Render slots
      renderSlots(rawSlots);

      // Check if selected slot became unavailable in background
      if (selectedSlot) {
        const currentSlotInList = rawSlots.find(s => s.id === selectedSlot.id);
        if (currentSlotInList && !currentSlotInList.available) {
          bookingErrorAlert.textContent = 'The slot you selected was just booked by someone else. Please choose another slot.';
          bookingErrorAlert.style.display = 'block';
          clearSelection();
        }
      }
    } catch (err) {
      if (!silent) {
        slotsError.textContent = err.message || 'Error loading appointment slots. Please try again.';
        slotsError.style.display = 'block';
      }
    } finally {
      if (!silent) {
        slotsLoading.style.display = 'none';
      }
    }
  }

  /**
   * Update provider dropdown list
   */
  function updateProviderOptions(slots) {
    const currentVal = providerSelect.value;
    const providers = new Set();
    slots.forEach(s => {
      if (s.provider) providers.add(s.provider);
    });

    // If options already match, do not rebuild
    const existingOptions = Array.from(providerSelect.options)
      .map(o => o.value)
      .filter(Boolean);
    const newProviders = Array.from(providers);

    if (existingOptions.length === newProviders.length && existingOptions.every(p => providers.has(p))) {
      return;
    }

    // Keep "All Providers"
    providerSelect.innerHTML = '<option value="">All Providers</option>';
    newProviders.sort().forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    });

    if (providers.has(currentVal)) {
      providerSelect.value = currentVal;
    }
  }

  /**
   * Render slots into the grid
   */
  function renderSlots(slots) {
    slotsContainer.innerHTML = '';

    if (slots.length === 0) {
      slotsEmpty.style.display = 'block';
      return;
    }

    slotsEmpty.style.display = 'none';

    slots.forEach(slot => {
      const card = document.createElement('div');
      const isAvailable = Boolean(slot.available);
      const isSelected = selectedSlot && selectedSlot.id === slot.id;

      card.className = `slot-card ${isAvailable ? 'available' : 'unavailable'} ${isSelected ? 'selected' : ''}`;
      card.setAttribute('data-slot-id', slot.id);

      const startFormatted = formatDateTime(slot.start);
      const endFormatted = formatDateTime(slot.end);

      card.innerHTML = `
        <div class="slot-header">
          <span class="slot-provider">${escapeHtml(slot.provider)}</span>
          <span class="slot-badge ${isAvailable ? 'available' : 'unavailable'}">
            ${isAvailable ? 'Available' : 'Booked'}
          </span>
        </div>
        <div class="slot-body">
          <div class="slot-date">📅 ${startFormatted.date}</div>
          <div class="slot-time">⏰ ${startFormatted.time} – ${endFormatted.time} (UTC)</div>
          <div class="slot-id-tag">Slot #${escapeHtml(slot.id)}</div>
        </div>
        <div class="slot-action">
          <button
            type="button"
            class="btn ${isAvailable ? (isSelected ? 'btn-primary' : 'btn-secondary') : 'btn-secondary'}"
            ${!isAvailable ? 'disabled' : ''}
            aria-label="${isAvailable ? `Select slot with ${slot.provider}` : 'Slot unavailable'}"
          >
            ${!isAvailable ? 'Unavailable' : (isSelected ? 'Selected ✓' : 'Select Slot')}
          </button>
        </div>
      `;

      if (isAvailable) {
        card.addEventListener('click', (e) => {
          // Prevent click loop if button itself clicked
          selectSlot(slot);
        });
      }

      slotsContainer.appendChild(card);
    });
  }

  /**
   * Slot selection handler
   */
  function selectSlot(slot) {
    if (!slot.available) return;

    selectedSlot = slot;
    bookingSlotIdInput.value = slot.id;

    // Update banner
    const startFormatted = formatDateTime(slot.start);
    const endFormatted = formatDateTime(slot.end);
    bannerProvider.textContent = slot.provider;
    bannerDatetime.textContent = `${startFormatted.date} from ${startFormatted.time} to ${endFormatted.time} (UTC)`;
    bannerSlotId.textContent = slot.id;
    selectedSlotBanner.style.display = 'block';
    cancelSelectionBtn.style.display = 'inline-flex';
    bookingErrorAlert.style.display = 'none';

    // Rerender slot grid to update selection styles
    renderSlots(allSlots);

    // Scroll booking form into view smoothly
    document.getElementById('booking-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Clear selected slot
   */
  function clearSelection() {
    selectedSlot = null;
    bookingSlotIdInput.value = '';
    selectedSlotBanner.style.display = 'none';
    cancelSelectionBtn.style.display = 'none';
    renderSlots(allSlots);
  }

  /**
   * Form validation
   */
  function validateBookingForm() {
    let isValid = true;
    const name = patientNameInput.value.trim();
    const email = patientEmailInput.value.trim();
    const slotId = bookingSlotIdInput.value.trim();

    if (!slotId) {
      bookingErrorAlert.textContent = 'Please select an available appointment slot before submitting.';
      bookingErrorAlert.style.display = 'block';
      isValid = false;
    } else {
      bookingErrorAlert.style.display = 'none';
    }

    if (!name) {
      nameError.style.display = 'block';
      patientNameInput.style.borderColor = 'var(--error-color)';
      isValid = false;
    } else {
      nameError.style.display = 'none';
      patientNameInput.style.borderColor = '';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      emailError.style.display = 'block';
      patientEmailInput.style.borderColor = 'var(--error-color)';
      isValid = false;
    } else {
      emailError.style.display = 'none';
      patientEmailInput.style.borderColor = '';
    }

    return isValid;
  }

  /**
   * Handle booking form submission
   */
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateBookingForm()) {
      return;
    }

    const payload = {
      slot_id: bookingSlotIdInput.value.trim(),
      name: patientNameInput.value.trim(),
      email: patientEmailInput.value.trim(),
    };

    // Keep reference to slot details before submitting
    const bookedSlotDetails = selectedSlot;

    // Set loading state
    isSubmitting = true;
    submitBookingBtn.disabled = true;
    btnText.textContent = 'Submitting...';
    btnSpinner.style.display = 'inline-block';
    bookingErrorAlert.style.display = 'none';

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete booking');
      }

      // Booking succeeded!
      lastConfirmedBooking = data;
      showConfirmation(data, bookedSlotDetails);

      // Reset form and slot selection
      patientNameInput.value = '';
      patientEmailInput.value = '';
      clearSelection();

      // Refresh slot list to show updated availability
      await fetchSlots(true);
    } catch (err) {
      bookingErrorAlert.textContent = err.message || 'An error occurred while booking. Please try again.';
      bookingErrorAlert.style.display = 'block';
    } finally {
      isSubmitting = false;
      submitBookingBtn.disabled = false;
      btnText.textContent = 'Confirm Booking';
      btnSpinner.style.display = 'none';
    }
  });

  /**
   * Display Confirmation Panel
   */
  function showConfirmation(booking, slotDetails) {
    confBookingId.textContent = booking.id;
    confPatientName.textContent = booking.name;
    confEmail.textContent = booking.email;
    confStatus.textContent = booking.status;
    confStatus.className = `status-badge status-${booking.status}`;

    // Provider and appointment time from slotDetails if available
    if (slotDetails) {
      const times = formatDateTime(slotDetails.start);
      const endTimes = formatDateTime(slotDetails.end);
      confProvider.textContent = slotDetails.provider;
      confDate.textContent = times.date;
      confTime.textContent = `${times.time} – ${endTimes.time} (UTC)`;
    } else {
      confProvider.textContent = booking.provider || 'Assigned Provider';
      confDate.textContent = booking.date || formatDateTime(booking.created_at).date;
      confTime.textContent = booking.time || formatDateTime(booking.created_at).time;
    }

    confirmationSection.style.display = 'block';
    confirmationSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Booking Lookup handler
   */
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = lookupBookingIdInput.value.trim();
    if (!id) return;

    lookupSubmitBtn.disabled = true;
    lookupBtnText.textContent = 'Looking up...';
    lookupBtnSpinner.style.display = 'inline-block';
    lookupErrorAlert.style.display = 'none';
    lookupResultPanel.style.display = 'none';

    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Booking not found');
      }

      // Populate lookup result panel
      lookBookingId.textContent = data.id;
      lookPatientName.textContent = data.name;
      lookEmail.textContent = data.email;
      lookStatus.textContent = data.status;
      lookStatus.className = `status-badge status-${data.status}`;

      // Slot info lookup if matching slot in memory
      const matchingSlot = allSlots.find(s => s.id === data.slot_id);
      if (matchingSlot) {
        const times = formatDateTime(matchingSlot.start);
        const endTimes = formatDateTime(matchingSlot.end);
        lookProvider.textContent = matchingSlot.provider;
        lookDate.textContent = times.date;
        lookTime.textContent = `${times.time} – ${endTimes.time} (UTC)`;
      } else {
        lookProvider.textContent = data.provider || `Slot ${data.slot_id}`;
        const createdTimes = formatDateTime(data.created_at);
        lookDate.textContent = `Created: ${createdTimes.date}`;
        lookTime.textContent = createdTimes.time;
      }

      lookupResultPanel.style.display = 'grid';
    } catch (err) {
      lookupErrorAlert.textContent = err.message || 'Booking not found. Please check the ID and try again.';
      lookupErrorAlert.style.display = 'block';
    } finally {
      lookupSubmitBtn.disabled = false;
      lookupBtnText.textContent = 'Look Up Booking';
      lookupBtnSpinner.style.display = 'none';
    }
  });

  /**
   * Look up current confirmation directly
   */
  lookupThisBookingBtn.addEventListener('click', () => {
    if (lastConfirmedBooking && lastConfirmedBooking.id) {
      lookupBookingIdInput.value = lastConfirmedBooking.id;
      lookupForm.dispatchEvent(new Event('submit'));
      document.querySelector('.lookup-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  /**
   * Book another slot button
   */
  bookAnotherBtn.addEventListener('click', () => {
    confirmationSection.style.display = 'none';
    document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  cancelSelectionBtn.addEventListener('click', () => {
    clearSelection();
  });

  refreshSlotsBtn.addEventListener('click', () => {
    fetchSlots(false);
  });

  providerSelect.addEventListener('change', () => {
    fetchSlots(false);
  });

  // Simple HTML Escaping
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initial runs
  checkHealth();
  fetchSlots(false);

  // Periodic polling every 30 seconds (silent refresh without disrupting user input)
  setInterval(() => {
    fetchSlots(true);
  }, 30000);
});
