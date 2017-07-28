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
/* eslint complexity: [2, 8] */
define([
  'okta',
  'vendor/lib/q',
  'util/FormController',
  'views/enroll-factors/Footer',
  'views/enroll-factors/PhoneTextBox',
  'views/shared/TextBox',
  'util/CountryUtil',
  'util/FormType',
  'shared/util/Keys'
],
function (Okta, Q, FormController, Footer, PhoneTextBox, TextBox, CountryUtil, FormType, Keys) {

  var _ = Okta._;
  var PUSH_INTERVAL = 6000;

  function sendPush(e) {
    if (Keys.isEnter(e)) {
      e.stopPropagation();
      e.preventDefault();
      if (e.type === 'keyup' && e.data && e.data.model) {
        e.data.model.sendPush();
      }
    }
  }

  return FormController.extend({
    className: 'enroll-call',
    Model: {
      props: {
        countryCode: ['string', true, 'US'],
        phoneNumber: ['string', true],
        phoneExtension: ['string', false],
        lastEnrolledPhoneNumber: 'string',
        passCode: ['string', true],
        factorId: 'string'
      },
      local: {
        hasExistingPhones: 'boolean',
        trapEnrollment: 'boolean',
        factorType: 'string',
        skipPhoneValidation: 'boolean'
      },
      derived: {
        countryCallingCode: {
          deps: ['countryCode'],
          fn: function (countryCode) {
            return '+' + CountryUtil.getCallingCodeForCountry(countryCode);
          }
        },
        fullPhoneNumber: {
          deps: ['countryCallingCode', 'phoneNumber'],
          fn: function (countryCallingCode, phoneNumber) {
            return phoneNumber ? (countryCallingCode + phoneNumber) : '';
          }
        },
        enrolled: {
          deps: ['lastEnrolledPhoneNumber', 'fullPhoneNumber'],
          fn: function (lastEnrolled, current) {
            return lastEnrolled === current;
          }
        }
      },
      sendPush: function () {
        var self = this;
        var phoneNumber = this.get('fullPhoneNumber');
        var phoneExtension = this.get('phoneExtension');

        self.trigger('errors:clear');

        if(!phoneNumber.length) {
          self.trigger('invalid', self, {'phoneNumber': 'model.validation.field.blank'});
          return;
        }

        return this.doTransaction(function(transaction) {
          var isMfaEnroll = transaction.status === 'MFA_ENROLL';
          var profileData = {
            phoneNumber: phoneNumber,
            updatePhone: isMfaEnroll ? self.get('hasExistingPhones') : true,
            phoneExtension: phoneExtension
          };

          if (self.get('skipPhoneValidation')) {
            profileData['validatePhone'] = false;
          }

          var doEnroll = function (trans) {
            var factor = _.findWhere(trans.factors, {
              factorType: self.get('factorType'),
              provider: 'OKTA'
            });
            return factor.enroll({
              profile: profileData
            })
            .then(function (trans) {
              return Q.delay(PUSH_INTERVAL).then(function() {
                return trans.poll(PUSH_INTERVAL);
              });
            })
            .fail(function (error) {
              if(error.errorCode === 'E0000098') { // E0000098: "This phone number is invalid."
                self.set('skipPhoneValidation', true);
                error.xhr.responseJSON.errorSummary = Okta.loc('enroll.sms.try_again', 'login');
              }
              throw error;
            });
          };

          if (isMfaEnroll) {
            return doEnroll(transaction);
          }
          else {
            // We must transition to MfaEnroll before updating the phone number
            self.set('trapEnrollment', true);
            return transaction.prev()
            .then(doEnroll)
            .then(function (trans) {
              self.set('trapEnrollment', false);
              return trans;
            });
          }
        // Rethrow errors so we can change state
        // AFTER setting the new transaction
        }, true)
        .then(function () {
          self.set('lastEnrolledPhoneNumber', phoneNumber);
        })
        .fail(function () {
          self.set('trapEnrollment', false);
        });
      }
    },

    Form: function () {
      var factorType = this.options.factorType;

      var formTitle = 'Phone Call Push';
      var formSubmit = Okta.loc('mfa.call', 'login');
      var formRetry = Okta.loc('mfa.redial', 'login');
      var formSubmitted = Okta.loc('mfa.calling', 'login');

      var numberFieldClassName = 'enroll-call-phone';
      var buttonClassName = 'call-request-button';

      var formChildren = [
        FormType.Input({
          name: 'countryCode',
          type: 'select',
          wide: true,
          options: CountryUtil.getCountries()
        }),
        FormType.Input({
          placeholder: Okta.loc('mfa.phoneNumber.placeholder', 'login'),
          className: numberFieldClassName,
          name: 'phoneNumber',
          input: PhoneTextBox,
          type: 'text',
          render: function () {
            this.$('input[name="phoneNumber"]')
              .off('keydown keyup', sendPush)
              .keydown(sendPush)
              .keyup({model: this.model}, sendPush);
          }
        })
      ];
      formChildren.push(FormType.Input({
        placeholder: Okta.loc('mfa.phoneNumber.ext.placeholder', 'login'),
        className: 'enroll-call-extension',
        name: 'phoneExtension',
        input: TextBox,
        type: 'text'
      }));
      formChildren.push(
        FormType.Button({
          title: formSubmit,
          attributes: { 'data-se': buttonClassName },
          className: 'button button-primary js-enroll-phone ' + buttonClassName,
          click: function () {
            this.model.sendPush();
            this.disable();
            this.options.title = formSubmitted;
            this.render();
          }
        })
      );

      return {
        title: formTitle,
        noButtonBar: true,
        autoSave: true,
        className: 'enroll-call',
        initialize: function () {
          this.listenTo(this.model, 'error errors:clear', function () {
            this.clearErrors();
          });
        },
        formChildren: formChildren
      };
    },

    Footer: Footer,

    trapAuthResponse: function () {
      if (this.options.appState.get('isMfaEnrollActivate')) {
        this.model.set('factorId', this.options.appState.get('activatedFactorId'));
        return true;
      }
      if (this.options.appState.get('isMfaEnroll') && this.model.get('trapEnrollment')) {
        return true;
      }
    },

    initialize: function () {
      this.model.set('hasExistingPhones', this.options.appState.get('hasExistingPhonesForCall'));
      this.model.set('factorType', this.options.factorType);
    }

  });

});
