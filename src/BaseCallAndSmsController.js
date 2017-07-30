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
  'util/FormController',
  'views/enroll-factors/Footer',
  'views/enroll-factors/PhoneTextBox',
  'views/shared/TextBox',
  'util/CountryUtil',
  'util/FormType',
  'shared/util/Keys'
],
function (Okta, FormController, Footer, PhoneTextBox, TextBox, CountryUtil, FormType, Keys) {

  var _ = Okta._;

  return FormController.extend({
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
        ableToResend: 'boolean',
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
      }
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

    setProperties: function () {
      if (this.options.factorType  === 'call') {
        this.model.set('hasExistingPhones', this.options.appState.get('hasExistingPhonesForCall'));
      } else {
        this.model.set('hasExistingPhones', this.options.appState.get('hasExistingPhones'));
      }
      this.model.set('factorType', this.options.factorType);
    }

  });

});
