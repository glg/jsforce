/*global process, Sfdc */
var inherits = require('inherits'),
    stream = require('stream'),
    Promise = require('./promise');

/* */

var request = require('requestretry'),
    canvas = require('./browser/canvas'),
    jsonp = require('./browser/jsonp');

// set options if defaults setting is available in request, which is not available in xhr module.
if (request.defaults) {
  var defaults = {
    followAllRedirects: true
  };
  if (process.env.HTTP_PROXY) {
    defaults.proxy = process.env.HTTP_PROXY;
  }
  if (process.env.HTTP_TIMEOUT) {
    defaults.timeout = process.env.HTTP_TIMEOUT;
  }
  request = request.defaults(defaults);
}

var baseUrl;
if (typeof window === 'undefined') {
  baseUrl = process.env.LOCATION_BASE_URL || "";
} else {
  var apiHost = normalizeApiHost(window.location.host);
  baseUrl = apiHost ? "https://" + apiHost : "";
}

/**
 * Add stream() method to promise (and following promise chain), to access original request stream.
 * @private
 */
function streamify(promise, factory) {
  var _then = promise.then;
  promise.then = function() {
    factory();
    var newPromise = _then.apply(promise, arguments);
    return streamify(newPromise, factory);
  };
  promise.stream = factory;
  return promise;
}

/**
 * Normarize Salesforce API host name
 * @private
 */
function normalizeApiHost(apiHost) {
  var m = /(\w+)\.(visual\.force|salesforce)\.com$/.exec(apiHost);
  if (m) {
    apiHost = m[1] + ".salesforce.com";
  }
  return apiHost;
}

/**
 * Class for HTTP request transport
 *
 * @class
 * @protected
 */
var Transport = module.exports = function() {};

/**
 * Make HTTP request, returns promise instead of stream
 *
 * @param {Object} params - HTTP request
 * @param {Callback.<Object>} [callback] - Calback Function
 * @param {Callback.<Object>} [options] - Options
 * @returns {Promise.<Object>}
 */
Transport.prototype.httpRequest = function(params, callback, options) {
  var deferred = Promise.defer();
  var req;
  var httpRequest = request;
  if (options && options.jsonp && jsonp.supported) {
    httpRequest = jsonp.createRequest(options.jsonp);
  } else if (options && options.signedRequest && canvas.supported) {
    httpRequest = canvas.createRequest(options.signedRequest);
  }
  var createRequest = function() {
    if (!req) {
      var opts = {
        ...params,
        maxAttempts: 3,
        retryDelay: 3500,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError
      };
      req = httpRequest(opts, function(err, response) {
        if (response.attempts > 1){
          // just for tracking we're gonna log information about any retries we encounter
          // we're gonna do this as console to force it out as opposed to trying to pick up
          // on whatever mechanisms this module may already be doing to controle logging
          console.log("JSForce performed %s attempts when making requests to %s", opts.url, response.attempts)
        }
        if (err) {
          deferred.reject(err);
        } else {
          deferred.resolve(response);
        }
      });
    }
    return req;
  };
  return streamify(deferred.promise, createRequest).thenCall(callback);
};

/**
 * Class for HTTP request transport using AJAX proxy service
 *
 * @class Transport~ProxyTransport
 * @protected
 * @extends Transport
 * @param {String} proxyUrl - AJAX Proxy server URL
 */
var ProxyTransport = Transport.ProxyTransport = function(proxyUrl) {
  this._proxyUrl = proxyUrl;
};

inherits(ProxyTransport, Transport);

/**
 * Make HTTP request via AJAX proxy
 *
 * @method Transport~ProxyTransport#httpRequest
 * @param {Object} params - HTTP request
 * @param {Callback.<Object>} [callback] - Calback Function
 * @returns {Promise.<Object>}
 */
ProxyTransport.prototype.httpRequest = function(params, callback) {
  var url = params.url;
  if (url.indexOf("/") === 0) {
    url = baseUrl + url;
  }
  var proxyParams = {
    method: params.method,
    url: this._proxyUrl + '?' + Date.now() + "." + ("" + Math.random()).substring(2),
    headers: {
      'salesforceproxy-endpoint': url
    }
  };
  if (params.body || params.body === "") {
    proxyParams.body = params.body;
  }
  if (params.headers) {
    for (var name in params.headers) {
      proxyParams.headers[name] = params.headers[name];
    }
  }
  return ProxyTransport.super_.prototype.httpRequest.call(this, proxyParams, callback);
};
