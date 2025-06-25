const LocalStorageManager = {
  set: function (key, value) {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.setItem(key, JSON.stringify(value))
  },

  get: function (key) {
    if (typeof localStorage === 'undefined') {
      return
    }

    const value = localStorage.getItem(key)

    return value ? JSON.parse(value) : null
  },
}

/**
 * Represents the API response.
 * @typedef {Object} ApiResponse
 * @property {string} id - The ID of the data.
 * @property {string} name - The name of the data.
 * @property {string} tngl - The tngl value.
 * @property {string} createdAt - The creation timestamp.
 * @property {string} updatedAt - The update timestamp.
 * @property {string|null} ownerId - The owner ID.
 */

/**
 * Retrieves tngl data from the API based on the given ID.
 * @param {string} id - The ID to fetch the tngl data.
 * @returns {Promise<ApiResponse>} A promise that resolves to the tngl data.
 * @throws {Error} If the API request fails.
 */

async function fetchTnglFromApiById(id) {
  const url =
    typeof window !== 'undefined' && location.href.match(/studio|localhost/)
      ? `/api/tnglcode?id=${id}`
      : `https://studio.spectoda.com/api/tnglcode?id=${id}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    LocalStorageManager.set(`tnglapidata_${id}`, data)
    return data
  } catch (error) {
    // Handle error case (e.g., network error, API error)
    const data = LocalStorageManager.get(`tnglapidata_${id}`)

    if (data) {
      console.warn('Warning:', 'You are offline. Using offline emulation.')
      return data
    }

    console.error('Error:', error)
  }
}

/**
 * Sends tngl data to the API.
 * @param {Object} options - The options object containing the data to send to the API.
 * @param {string} options.tngl - The tngl value to send.
 * @param {string} options.name - The name value to send.
 * @param {string=} options.id - The optional ID value to send.
 * @returns {Promise<ApiResponse>} A promise that resolves to the response data.
 * @throws {Error} If the API request fails.
 */

async function sendTnglToApi({ tngl, name, id }) {
  const url =
    typeof window !== 'undefined' && location.href.match(/studio|localhost/)
      ? `/api/tnglcode?id=${id}`
      : `https://studio.spectoda.com/api/tnglcode?id=${id}`

  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tngl, name, id }),
  }

  try {
    const response = await fetch(url, options)
    const responseData = await response.json()

    LocalStorageManager.set(`tnglapidata_${id}`, responseData) // save successful response to local storage
    return responseData
  } catch (error) {
    const data = LocalStorageManager.set(`tnglapidata_${id}`, {
      tngl,
      name,
      id,
    })

    if (data) {
      console.warn('Warning:', 'You are offline. Using offline emulation.')
      return data
    }
    console.error('Error:', error)
  }
}

if (typeof window !== 'undefined') {
  window.fetchTnglFromApiById = fetchTnglFromApiById
  window.sendTnglToApi = sendTnglToApi
}

export { fetchTnglFromApiById, sendTnglToApi }
