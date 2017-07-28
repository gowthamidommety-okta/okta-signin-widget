/*!
 * Copyright (c) 2015-2016, Okta, Inc. and/or its affiliates. All rights reserved.
 * The Okta software accompanied by this notice is provided pursuant to the Apache License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and limitations under the License.
 */

define(['okta', 'util/CookieUtil', 'util/Util'], function (Okta, CookieUtil, Util) {

  var _ = Okta._;
  // deviceName is escaped on BaseForm (see BaseForm's template)
  var titleTpl = Okta.Handlebars.compile('{{factorName}} ({{{deviceName}}})');
  var subtitleTpl = Okta.Handlebars.compile('({{subtitle}})');
  var WARNING_TIMEOUT = 30000; //milliseconds
  var warningTemplate = '<div class="okta-form-infobox-warning infobox infobox-warning">\
                           <span class="icon warning-16"></span>\
                           <p>{{warning}}</p>\
                         </div>';
  function getFormAndButtonDetails(factorType) {
    switch(factorType) {
    case 'push':
      return {
        send: Okta.loc('oktaverify.send', 'login'),
        resend: Okta.loc('oktaverify.resend', 'login'),
        sent: Okta.loc('oktaverify.sent', 'login'),
        timeout: Okta.loc('oktaverify.timeout', 'login'),
        title: titleTpl({factorName: this.model.get('factorLabel'), deviceName: this.model.get('deviceName')}),
      };
    case 'call':
      return {
        send: 'Call',
        resend: 'Redial',
        sent: 'Calling',
        timeout: 'Your call has expired',
        title: this.model.get('factorLabel'),
        subtitle: subtitleTpl({ subtitle: this.model.get('phoneNumber') }),
      };
    default:
      return {
        send: '',
        resend: '',
        sent: '',
        timeout: '',
      };
    }
  }

  return Okta.Form.extend({
    className: 'mfa-verify-push',
    autoSave: true,
    noCancelButton: true,
    scrollOnError: false,
    layout: 'o-form-theme',
    attributes: { 'data-se': 'factor-push' },
    events: {
      submit: 'submit'
    },

    initialize: function () {
      this.enabled = true;
      var factorType = this.model.get('factorType');
      this.formAndButtonDetails = getFormAndButtonDetails.call(this, factorType);
      this.save = this.formAndButtonDetails.send;
      if(this.formAndButtonDetails.subtitle) {
        this.subtitle = this.formAndButtonDetails.subtitle;
      }
      this.listenTo(this.options.appState, 'change:isMfaRejectedByUser',
        function (state, isMfaRejectedByUser) {
          this.setSubmitState(isMfaRejectedByUser);
          if (isMfaRejectedByUser) {
            this.showError(Okta.loc('oktaverify.rejected', 'login'));
          }
        }
      );
      this.listenTo(this.options.appState, 'change:isMfaTimeout',
        function (state, isMfaTimeout) {
          this.setSubmitState(isMfaTimeout);
          if (isMfaTimeout) {
            this.showError(this.formAndButtonDetails.timeout);
          }
        }
      );
      this.listenTo(this.options.appState, 'change:isMfaRequired',
        function (state, isMfaRequired) {
          if (isMfaRequired) {
            this.clearErrors();
            this.clearWarnings();
          }
        }
      );
      this.title = this.formAndButtonDetails.title;
    },
    setSubmitState: function (ableToSubmit, buttonValue) {
      var button = this.$el.find('.button');
      this.enabled = ableToSubmit;
      if (ableToSubmit) {
        var buttonValue = buttonValue || this.formAndButtonDetails.send;
        button.removeClass('link-button-disabled');
        button.prop('value', buttonValue);
        button.prop('disabled', false);
      } else {
        button.addClass('link-button-disabled');
        button.prop('value', this.formAndButtonDetails.sent);
        button.prop('disabled', true);
      }
    },
    submit: function (e) {
      if (e !== undefined) {
        e.preventDefault();
      }
      if (this.enabled) {
        this.setSubmitState(false);
        this.doSave();
      }
    },
    postRender: function() {
      if (this.settings.get('features.autoPush') && CookieUtil.isAutoPushEnabled(this.options.appState.get('userId'))) {
        this.model.set('autoPush', true);
        // bind after $el has been rendered, and trigger push once DOM is fully loaded
        _.defer(_.bind(this.submit, this));
      }
    },
    doSave: function () {
      var timeout;
      this.clearErrors();
      this.clearWarnings();
      if (this.model.get('factorType') == 'push') {
        if(this.model.isValid()) {
          this.listenToOnce(this.model, 'error', function() {
            this.setSubmitState(true);
            this.clearWarnings();
            clearTimeout(timeout);
          });
          this.trigger('save', this.model);
          timeout = Util.callAfterTimeout(_.bind(function() {
            this.showWarning(Okta.loc('oktaverify.warning', 'login'));
          }, this), WARNING_TIMEOUT);
        }
      }
      else if (this.model.get('factorType') == 'call') {
        this.listenToOnce(this.model, 'error', function() {
          this.setSubmitState(true);
          this.clearWarnings();
          clearTimeout(timeout);
        });
        this.trigger('save', this.model);
        timeout = Util.callAfterTimeout(_.bind(function() {
          this.setSubmitState(true, this.formAndButtonDetails.resend);
        }, this), WARNING_TIMEOUT);
      }
    },
    showError: function (msg) {
      this.clearWarnings();
      this.model.trigger('error', this.model, {responseJSON: {errorSummary: msg}});
    },
    showWarning: function(msg) {
      this.clearWarnings();
      this.add(warningTemplate, '.o-form-error-container', {options: {warning: msg}});
    },
    clearWarnings: function() {
      this.$('.okta-form-infobox-warning').remove();
    }
  });
});
