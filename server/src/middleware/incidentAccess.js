function sameId(left, right) {
  return Boolean(left && right && String(left._id || left) === String(right._id || right))
}

function canAccessIncident(user, incident) {
  if (!user || !incident) return false
  if (user.role === 'admin') return true
  if (user.role === 'patient') return sameId(user._id, incident.patient)
  if (user.role === 'paramedic') return sameId(user.ambulanceId, incident.assignedAmbulance)
  if (user.role === 'hospital_staff') return sameId(user.hospitalId, incident.allocatedHospital)
  return false
}

module.exports = { canAccessIncident }
