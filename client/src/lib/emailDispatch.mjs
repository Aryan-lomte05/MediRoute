export async function dispatchEmergencyEmail(emailClient, config, recipientEmail, templateParams) {
  if (!config.serviceId || !config.templateId || !config.publicKey || !recipientEmail) {
    return { success: false, error: 'Email alert delivery is not configured.' }
  }

  try {
    const response = await emailClient.send(
      config.serviceId,
      config.templateId,
      templateParams,
      { publicKey: config.publicKey }
    )
    return { success: true, status: response.status }
  } catch (error) {
    return { success: false, error: error?.text || error?.message || 'EmailJS send failed' }
  }
}
